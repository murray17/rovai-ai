use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::sync::{Semaphore, watch};

pub const SESSION_LIFETIME: Duration = Duration::from_secs(30 * 60);
const MAX_SESSIONS: usize = 32;
const LOGIN_ATTEMPTS: usize = 12;
const LOGIN_WINDOW: Duration = Duration::from_secs(60);

/// Plaintext credentials have no Debug/Serialize implementation and are never
/// retained in this store. The process owner alone receives freshly made tokens.
pub struct Sessions(Mutex<SessionState>);
struct SessionState {
    enabled: bool,
    administrator: [u8; 32],
    sessions: HashMap<[u8; 32], Arc<Session>>,
    attempts: VecDeque<Instant>,
}

pub struct Session {
    pub client_id: String,
    pub expires_at: Instant,
    pub revoked: watch::Sender<bool>,
    pub streams: Arc<Semaphore>,
}

pub enum LoginFailure {
    Throttled,
    Unauthorized,
    Capacity,
}

pub fn new_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| anyhow::anyhow!("system random source unavailable"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn digest(kind: &[u8], token: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(kind);
    hash.update(token.as_bytes());
    hash.finalize().into()
}

fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl Sessions {
    pub fn new(administrator: &str) -> Result<Self> {
        ensure!(
            valid_token(administrator),
            "administrator token must be 32 random bytes encoded as 64 hexadecimal characters"
        );
        Ok(Self(Mutex::new(SessionState {
            enabled: true,
            administrator: digest(b"rovai-administrator-v1\0", administrator),
            sessions: HashMap::new(),
            attempts: VecDeque::new(),
        })))
    }

    pub fn login(
        &self,
        administrator: &str,
    ) -> std::result::Result<(String, Arc<Session>), LoginFailure> {
        let now = Instant::now();
        let mut state = self.0.lock().expect("session registry poisoned");
        if !state.enabled {
            return Err(LoginFailure::Unauthorized);
        }
        while state
            .attempts
            .front()
            .is_some_and(|time| now.duration_since(*time) >= LOGIN_WINDOW)
        {
            state.attempts.pop_front();
        }
        if state.attempts.len() >= LOGIN_ATTEMPTS {
            return Err(LoginFailure::Throttled);
        }
        state.attempts.push_back(now);
        let candidate = digest(b"rovai-administrator-v1\0", administrator);
        if !valid_token(administrator) || !bool::from(state.administrator.ct_eq(&candidate)) {
            return Err(LoginFailure::Unauthorized);
        }
        state.sessions.retain(|_, session| {
            if session.expires_at <= now {
                session.revoked.send_replace(true);
                false
            } else {
                true
            }
        });
        if state.sessions.len() >= MAX_SESSIONS {
            return Err(LoginFailure::Capacity);
        }
        let token = new_token().map_err(|_| LoginFailure::Capacity)?;
        let client_id = new_token().map_err(|_| LoginFailure::Capacity)?;
        let (revoked, _) = watch::channel(false);
        let session = Arc::new(Session {
            client_id,
            expires_at: now + SESSION_LIFETIME,
            revoked,
            streams: Arc::new(Semaphore::new(2)),
        });
        state
            .sessions
            .insert(digest(b"rovai-session-v1\0", &token), session.clone());
        Ok((token, session))
    }

    pub fn authenticate(&self, token: &str) -> Option<Arc<Session>> {
        if !valid_token(token) {
            return None;
        }
        let key = digest(b"rovai-session-v1\0", token);
        let mut state = self.0.lock().expect("session registry poisoned");
        if !state.enabled {
            return None;
        }
        let session = state.sessions.get(&key)?.clone();
        if session.expires_at <= Instant::now() || *session.revoked.borrow() {
            state.sessions.remove(&key);
            session.revoked.send_replace(true);
            return None;
        }
        Some(session)
    }

    pub fn revoke(&self, session: &Session) {
        session.revoked.send_replace(true);
        self.0
            .lock()
            .expect("session registry poisoned")
            .sessions
            .retain(|_, stored| stored.client_id != session.client_id);
    }

    pub fn rotate(&self, administrator: &str) -> Result<()> {
        ensure!(valid_token(administrator), "invalid administrator token");
        let mut state = self.0.lock().expect("session registry poisoned");
        state.administrator = digest(b"rovai-administrator-v1\0", administrator);
        for session in state.sessions.values() {
            session.revoked.send_replace(true);
        }
        state.sessions.clear();
        state.attempts.clear();
        Ok(())
    }

    pub fn close(&self) {
        let mut state = self.0.lock().expect("session registry poisoned");
        state.enabled = false;
        for session in state.sessions.values() {
            session.revoked.send_replace(true);
        }
        state.sessions.clear();
    }

    pub fn count(&self) -> usize {
        self.0
            .lock()
            .expect("session registry poisoned")
            .sessions
            .values()
            .filter(|session| session.expires_at > Instant::now() && !*session.revoked.borrow())
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // This pure owner covers credential state transitions; it deliberately has
    // no Core, files, sockets, timers or Runtime fixture.
    #[test]
    fn sessions_are_independent_revocable_expiring_and_do_not_survive_listener_close() {
        let administrator = new_token().unwrap();
        let sessions = Sessions::new(&administrator).unwrap();
        assert!(sessions.authenticate(&administrator).is_none());
        let (first_token, first) = sessions.login(&administrator).ok().unwrap();
        let (second_token, second) = sessions.login(&administrator).ok().unwrap();
        assert_ne!(first.client_id, second.client_id);
        assert_ne!(first_token, second_token);
        assert!(sessions.authenticate(&first_token).is_some());
        sessions.revoke(&first);
        assert!(*first.revoked.borrow());
        assert!(sessions.authenticate(&first_token).is_none());
        assert!(sessions.authenticate(&second_token).is_some());
        let replacement = new_token().unwrap();
        sessions.rotate(&replacement).unwrap();
        assert!(*second.revoked.borrow());
        assert!(sessions.authenticate(&second_token).is_none());
        assert!(matches!(
            sessions.login(&administrator),
            Err(LoginFailure::Unauthorized)
        ));
        let (expired_token, expired) = sessions.login(&replacement).ok().unwrap();
        drop(expired);
        let key = digest(b"rovai-session-v1\0", &expired_token);
        Arc::get_mut(sessions.0.lock().unwrap().sessions.get_mut(&key).unwrap())
            .unwrap()
            .expires_at = Instant::now();
        assert!(sessions.authenticate(&expired_token).is_none());
        let (live_token, live) = sessions.login(&replacement).ok().unwrap();
        sessions.close();
        assert!(*live.revoked.borrow());
        assert!(sessions.authenticate(&live_token).is_none());
        assert!(matches!(
            sessions.login(&replacement),
            Err(LoginFailure::Unauthorized)
        ));
        assert_eq!(sessions.count(), 0);
    }

    #[test]
    fn login_admission_bounds_attempts_sessions_and_malformed_credentials() {
        let administrator = new_token().unwrap();
        for invalid in ["", "x", &"g".repeat(64), &"a".repeat(63)] {
            assert!(Sessions::new(invalid).is_err());
        }
        let sessions = Sessions::new(&administrator).unwrap();
        for _ in 0..LOGIN_ATTEMPTS {
            assert!(matches!(
                sessions.login("bad"),
                Err(LoginFailure::Unauthorized)
            ));
        }
        assert!(matches!(
            sessions.login(&administrator),
            Err(LoginFailure::Throttled)
        ));
        sessions.0.lock().unwrap().attempts.clear();
        // Cardinality is the property being tested; avoid waiting for rate windows.
        for _ in 0..MAX_SESSIONS {
            sessions.0.lock().unwrap().attempts.clear();
            assert!(sessions.login(&administrator).is_ok());
        }
        assert!(matches!(
            sessions.login(&administrator),
            Err(LoginFailure::Capacity)
        ));
    }
}

use std::{ffi::c_void, io, mem::size_of, ptr::null_mut};

use anyhow::{Context, Result, bail};
use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_SUCCESS, GENERIC_ALL, HANDLE, LocalFree},
    Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_SIZE_INFORMATION, AclSizeInformation,
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            GetSecurityInfo, SDDL_REVISION_1, SE_FILE_OBJECT, SE_KERNEL_OBJECT,
        },
        CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, GetAce, GetAclInformation,
        GetSecurityDescriptorControl, GetTokenInformation, OBJECT_INHERIT_ACE,
        OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED,
        SECURITY_ATTRIBUTES, TOKEN_GROUPS, TOKEN_QUERY, TOKEN_USER, TokenLogonSid, TokenUser,
    },
    Storage::FileSystem::FILE_ALL_ACCESS,
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const ACCESS_ALLOWED_ACE_TYPE_VALUE: u8 = 0;
const LOCAL_SYSTEM_SID: &str = "S-1-5-18";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrivateObjectKind {
    Directory,
    File,
    NamedPipe,
}

/// Owns a self-relative security descriptor allocated by Windows.
///
/// The descriptor always has a protected DACL. Filesystem descriptors use the
/// current user SID as owner and principal; named pipes use the narrower
/// session logon SID so another logon session for the same account is denied.
pub(crate) struct PrivateSecurityDescriptor {
    descriptor: PSECURITY_DESCRIPTOR,
    principal_sid: String,
    kind: PrivateObjectKind,
}

impl PrivateSecurityDescriptor {
    pub(crate) fn new(kind: PrivateObjectKind) -> Result<Self> {
        let principal_sid = match kind {
            PrivateObjectKind::Directory | PrivateObjectKind::File => current_windows_user_sid()?,
            PrivateObjectKind::NamedPipe => current_windows_logon_sid()?,
        };
        let sddl = match kind {
            PrivateObjectKind::Directory => {
                format!("O:{principal_sid}D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;{principal_sid})")
            }
            PrivateObjectKind::File => {
                format!("O:{principal_sid}D:P(A;;FA;;;SY)(A;;FA;;;{principal_sid})")
            }
            PrivateObjectKind::NamedPipe => {
                format!("D:P(A;;GA;;;SY)(A;;GA;;;{principal_sid})")
            }
        };
        let sddl_wide = wide_nul(&sddl);
        let mut descriptor = null_mut();
        let converted = unsafe {
            // SAFETY: sddl_wide is NUL-terminated and descriptor is a valid
            // output pointer. Windows allocates the returned self-relative
            // descriptor with LocalAlloc; Drop releases it with LocalFree.
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl_wide.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        };
        if converted == 0 || descriptor.is_null() {
            return Err(io::Error::last_os_error())
                .context("failed to build the protected Windows security descriptor");
        }
        Ok(Self {
            descriptor,
            principal_sid,
            kind,
        })
    }

    pub(crate) fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.descriptor,
            bInheritHandle: 0,
        }
    }

    pub(crate) fn verify_file_handle(&self, handle: HANDLE) -> Result<()> {
        if self.kind == PrivateObjectKind::NamedPipe {
            bail!("named-pipe descriptors cannot admit filesystem objects");
        }
        let security = SecurityInfo::from_file_handle(handle)?;
        security.verify_private_policy(self.kind, &self.principal_sid)
    }

    pub(crate) fn verify_named_pipe_handle(&self, handle: HANDLE) -> Result<()> {
        if self.kind != PrivateObjectKind::NamedPipe {
            bail!("filesystem descriptors cannot admit named-pipe objects");
        }
        let security = SecurityInfo::from_named_pipe_handle(handle)?;
        security.verify_private_policy(self.kind, &self.principal_sid)
    }
}

impl Drop for PrivateSecurityDescriptor {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: descriptor was allocated by
            // ConvertStringSecurityDescriptorToSecurityDescriptorW and remains
            // exclusively owned by this value.
            LocalFree(self.descriptor);
        }
    }
}

struct SecurityInfo {
    descriptor: PSECURITY_DESCRIPTOR,
    owner: PSID,
    dacl: *mut ACL,
}

impl SecurityInfo {
    fn from_file_handle(handle: HANDLE) -> Result<Self> {
        Self::from_handle(handle, SE_FILE_OBJECT, true)
            .context("failed to read Windows filesystem security information")
    }

    fn from_named_pipe_handle(handle: HANDLE) -> Result<Self> {
        Self::from_handle(handle, SE_KERNEL_OBJECT, false)
            .context("failed to read Windows named-pipe security information")
    }

    fn from_handle(
        handle: HANDLE,
        object_type: windows_sys::Win32::Security::Authorization::SE_OBJECT_TYPE,
        include_owner: bool,
    ) -> Result<Self> {
        let mut owner = null_mut();
        let mut dacl = null_mut();
        let mut descriptor = null_mut();
        let security_information = DACL_SECURITY_INFORMATION
            | if include_owner {
                OWNER_SECURITY_INFORMATION
            } else {
                0
            };
        let status = unsafe {
            // SAFETY: handle is owned by the caller and the output pointers are
            // valid. The returned descriptor owns the owner/DACL storage.
            GetSecurityInfo(
                handle,
                object_type,
                security_information,
                &mut owner,
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        if status != ERROR_SUCCESS || descriptor.is_null() {
            return Err(io::Error::from_raw_os_error(status as i32).into());
        }
        Ok(Self {
            descriptor,
            owner,
            dacl,
        })
    }

    fn verify_private_policy(&self, kind: PrivateObjectKind, current_user_sid: &str) -> Result<()> {
        if kind != PrivateObjectKind::NamedPipe
            && (self.owner.is_null() || sid_to_string(self.owner)? != current_user_sid)
        {
            bail!("filesystem object owner is not the current Windows user");
        }

        let mut control = 0_u16;
        let mut revision = 0_u32;
        if unsafe {
            // SAFETY: descriptor is live for the duration of this value and both
            // output pointers are valid.
            GetSecurityDescriptorControl(self.descriptor, &mut control, &mut revision)
        } == 0
        {
            return Err(io::Error::last_os_error())
                .context("failed to inspect Windows security descriptor control flags");
        }
        if control & SE_DACL_PROTECTED == 0 {
            bail!("filesystem object DACL is not protected from inheritance");
        }
        if self.dacl.is_null() {
            bail!("filesystem object has no explicit DACL");
        }

        let mut acl_info = ACL_SIZE_INFORMATION::default();
        if unsafe {
            // SAFETY: dacl belongs to the live security descriptor and acl_info
            // has the size required by AclSizeInformation.
            GetAclInformation(
                self.dacl,
                (&mut acl_info as *mut ACL_SIZE_INFORMATION).cast(),
                size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        } == 0
        {
            return Err(io::Error::last_os_error())
                .context("failed to inspect Windows DACL entries");
        }
        if acl_info.AceCount != 2 {
            bail!(
                "filesystem object DACL has {} entries; expected exactly 2",
                acl_info.AceCount
            );
        }

        let expected_flags = match kind {
            PrivateObjectKind::Directory => (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8,
            PrivateObjectKind::File | PrivateObjectKind::NamedPipe => 0,
        };
        let expected_mask = match kind {
            PrivateObjectKind::Directory | PrivateObjectKind::File => FILE_ALL_ACCESS,
            PrivateObjectKind::NamedPipe => GENERIC_ALL,
        };
        let mut entries = Vec::with_capacity(2);
        for index in 0..acl_info.AceCount {
            let mut raw_ace: *mut c_void = null_mut();
            if unsafe {
                // SAFETY: index is bounded by the ACE count returned for this
                // same DACL, and raw_ace is a valid output pointer.
                GetAce(self.dacl, index, &mut raw_ace)
            } == 0
            {
                return Err(io::Error::last_os_error())
                    .context("failed to read a Windows DACL entry");
            }
            if raw_ace.is_null() {
                bail!("Windows returned a null DACL entry");
            }
            let ace = unsafe {
                // SAFETY: only ACCESS_ALLOWED_ACE is accepted below, and the
                // pointer came directly from GetAce for the live DACL.
                &*raw_ace.cast::<ACCESS_ALLOWED_ACE>()
            };
            if ace.Header.AceType != ACCESS_ALLOWED_ACE_TYPE_VALUE
                || ace.Header.AceFlags != expected_flags
                || ace.Mask != expected_mask
            {
                bail!("private object DACL contains an unexpected access entry");
            }
            let sid = std::ptr::addr_of!(ace.SidStart).cast_mut().cast();
            entries.push(sid_to_string(sid)?);
        }
        entries.sort();
        let mut expected = [LOCAL_SYSTEM_SID.to_string(), current_user_sid.to_string()];
        expected.sort();
        if entries != expected {
            bail!("private object DACL is not limited to SYSTEM and the admitted principal");
        }
        Ok(())
    }
}

impl Drop for SecurityInfo {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: descriptor was allocated by GetSecurityInfo and owns the
            // owner and DACL pointers stored alongside it.
            LocalFree(self.descriptor);
        }
    }
}

fn current_windows_user_sid() -> Result<String> {
    let token = current_process_token()?;
    let buffer = token_information(&token, TokenUser)?;
    let token_user = unsafe {
        // SAFETY: GetTokenInformation populated buffer with TOKEN_USER.
        &*buffer.as_ptr().cast::<TOKEN_USER>()
    };
    sid_to_string(token_user.User.Sid)
}

fn current_windows_logon_sid() -> Result<String> {
    let token = current_process_token()?;
    let buffer = token_information(&token, TokenLogonSid)?;
    let token_groups = unsafe {
        // SAFETY: GetTokenInformation populated buffer with TOKEN_GROUPS.
        &*buffer.as_ptr().cast::<TOKEN_GROUPS>()
    };
    if token_groups.GroupCount != 1 {
        bail!(
            "current process token has {} logon SIDs; expected exactly one",
            token_groups.GroupCount
        );
    }
    sid_to_string(token_groups.Groups[0].Sid)
}

struct TokenHandle(HANDLE);

impl Drop for TokenHandle {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: the handle was returned by OpenProcessToken and is owned
            // by this wrapper.
            CloseHandle(self.0);
        }
    }
}

fn current_process_token() -> Result<TokenHandle> {
    let mut token = null_mut();
    if unsafe {
        // SAFETY: token is a valid output pointer and the pseudo process handle
        // is valid in the current process.
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
    } == 0
    {
        return Err(io::Error::last_os_error()).context("failed to open the current process token");
    }
    Ok(TokenHandle(token))
}

fn token_information(
    token: &TokenHandle,
    information_class: windows_sys::Win32::Security::TOKEN_INFORMATION_CLASS,
) -> Result<Vec<usize>> {
    let mut required = 0_u32;
    unsafe {
        // SAFETY: the zero-length probe intentionally supplies no output buffer.
        GetTokenInformation(token.0, information_class, null_mut(), 0, &mut required);
    }
    if required == 0 {
        return Err(io::Error::last_os_error())
            .context("failed to size current process token information");
    }
    let word_size = size_of::<usize>();
    let word_count = (required as usize).div_ceil(word_size);
    let mut buffer = vec![0_usize; word_count];
    let buffer_length = (buffer.len() * word_size) as u32;
    if unsafe {
        // SAFETY: the word buffer is naturally aligned for every token
        // structure we inspect, has at least the capacity returned by the
        // probe, and remains live while its contents are read.
        GetTokenInformation(
            token.0,
            information_class,
            buffer.as_mut_ptr().cast(),
            buffer_length,
            &mut required,
        )
    } == 0
    {
        return Err(io::Error::last_os_error())
            .context("failed to read current process token information");
    }
    Ok(buffer)
}

fn sid_to_string(sid: PSID) -> Result<String> {
    if sid.is_null() {
        bail!("Windows security descriptor contains a null SID");
    }
    let mut sid_text = null_mut();
    if unsafe {
        // SAFETY: sid comes from a live token or security descriptor and
        // sid_text is a valid output pointer.
        ConvertSidToStringSidW(sid, &mut sid_text)
    } == 0
        || sid_text.is_null()
    {
        return Err(io::Error::last_os_error()).context("failed to format a Windows SID");
    }
    let length = unsafe {
        // SAFETY: ConvertSidToStringSidW returns a NUL-terminated LocalAlloc
        // string when successful.
        let mut length = 0_usize;
        while *sid_text.add(length) != 0 {
            length += 1;
        }
        length
    };
    let result = String::from_utf16(unsafe {
        // SAFETY: length was measured within the returned NUL-terminated string.
        std::slice::from_raw_parts(sid_text, length)
    });
    unsafe {
        // SAFETY: sid_text was allocated by ConvertSidToStringSidW.
        LocalFree(sid_text.cast());
    }
    result.context("Windows SID is not valid UTF-16")
}

fn wide_nul(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_named_pipe_uses_the_session_logon_sid_not_the_user_sid() {
        let user_sid = current_windows_user_sid().unwrap();
        let logon_sid = current_windows_logon_sid().unwrap();
        assert_ne!(logon_sid, user_sid);
        assert!(logon_sid.starts_with("S-1-5-5-"));

        let descriptor = PrivateSecurityDescriptor::new(PrivateObjectKind::NamedPipe).unwrap();
        assert_eq!(descriptor.principal_sid, logon_sid);
        assert_eq!(descriptor.attributes().bInheritHandle, 0);
    }
}

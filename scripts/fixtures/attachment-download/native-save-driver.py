"""Drive actual GTK windows with keys on the test's private Xvfb/DBus display."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time

root = Path(sys.argv[1])
original = 'User-edited destination: must survive cancellation.\n'
deadline = time.monotonic() + 65
observations = []


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=5).stdout


def windows():
    clients = re.findall(r'0x[0-9a-f]+', command('xprop', '-root', '_NET_CLIENT_LIST'))
    result = []
    for window in clients:
        try:
            properties = command('xprop', '-id', window, '_NET_WM_NAME', 'WM_TRANSIENT_FOR', '_NET_WM_STATE', '_NET_WM_WINDOW_TYPE')
            parent = re.search(r'WM_TRANSIENT_FOR.*?(0x[0-9a-f]+)', properties)
            result.append({'id': window, 'parent': parent.group(1) if parent else None, 'properties': properties})
        except subprocess.CalledProcessError:
            pass  # The chooser may close between enumeration and inspection.
    return result


def state():
    try:
        return json.loads((root / 'status.json').read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def wait_for(check, message):
    while time.monotonic() < deadline:
        found = check()
        if found:
            return found
        time.sleep(.1)
    subprocess.run(['scrot', str(root / 'native-failure.png')], timeout=5, check=False)
    raise AssertionError(message + '\n' + json.dumps({'state': state(), 'windows': windows()}, ensure_ascii=False))


def key(window, name):
    command('xdotool', 'windowactivate', '--sync', window['id'])
    command('xdotool', 'key', '--clearmodifiers', name)


def chooser():
    return next((window for window in windows() if 'Attachment save overwrite acceptance' in window['properties']), None)


for scenario in ['cancel', 'confirm']:
    wait_for(lambda: state().get('scenario') == scenario and state().get('phase') == 'dialog-open', 'Save operation did not start')
    save_window = wait_for(chooser, 'Native chooser window missing')
    # Chromium ignores acceptance during its 500ms input-protection window.
    # GTK's Save button has an explicit _Save mnemonic; filename Enter need
    # not activate a default response in the native chooser.
    time.sleep(.6)
    key(save_window, 'alt+s')
    confirmation = wait_for(lambda: next((window for window in windows()
        if window['parent'] == save_window['parent'] and '替换文件' in window['properties']
        and '_NET_WM_STATE_MODAL' in window['properties'] and '_NET_WM_WINDOW_TYPE_DIALOG' in window['properties']), None),
        'Existing file was accepted without a visible Main replacement dialog')
    assert state() == {'scenario': scenario, 'phase': 'overwrite-open'}, 'Copy advanced before replacement confirmation'
    assert (root / 'edited.txt').read_text() == original, 'Destination changed before confirmation'
    command('scrot', str(root / ('overwrite-' + scenario + '.png')))
    observations.append({'scenario': scenario, 'confirmation': confirmation, 'destination': 'edited.txt',
        'destinationPreservedBeforeConfirmation': True})
    print(json.dumps({'scenario': scenario, 'replacementWindow': confirmation}), flush=True)
    # The production Main prompt defaults to Cancel. Tab moves to Replace.
    if scenario == 'confirm':
        key(confirmation, 'Tab')
    key(confirmation, 'Escape' if scenario == 'cancel' else 'Return')

wait_for(lambda: state().get('phase') == 'done', 'Native save assertions did not finish')
(root / 'native-dialog-report.json').write_text(json.dumps({'driver': 'X11 native keyboard; private display',
    'overwriteDialogs': observations}, indent=2))
print(json.dumps({'nativeOverwriteConfirmations': len(observations)}))

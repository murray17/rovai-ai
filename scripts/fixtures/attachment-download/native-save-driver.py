"""Operate actual GTK dialogs on the test's private Xvfb/DBus display."""
import json
from pathlib import Path
import subprocess
import sys
import time
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

Atspi.init()

root = Path(sys.argv[1])
original = 'User-edited destination: must survive cancellation.\n'
deadline = time.monotonic() + 65
observations = []


def nodes(parent=None, depth=0):
    if parent is None:
        parent = Atspi.get_desktop(0)
    if parent is None or depth > 18:
        return
    yield parent
    try:
        children = [parent.get_child_at_index(i) for i in range(min(parent.get_child_count(), 400))]
    except Exception:
        return
    for child in children:
        if child is not None:
            yield from nodes(child, depth + 1)


def state():
    try:
        return json.loads((root / 'status.json').read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def button(name, parent=None):
    for node in nodes(parent):
        try:
            if (node.get_role() == Atspi.Role.PUSH_BUTTON
                    and node.get_name().replace('_', '').casefold() == name.casefold()
                    and node.get_state_set().contains(Atspi.StateType.SHOWING)):
                return node
        except Exception:
            pass


def wait_for(check, message):
    while time.monotonic() < deadline:
        found = check()
        if found:
            return found
        time.sleep(.1)
    tree = []
    for node in nodes():
        try:
            tree.append([node.get_role_name(), node.get_name()])
        except Exception:
            pass
    raise AssertionError(message + '\n' + json.dumps({'state': state(), 'tree': tree}, ensure_ascii=False))


def click(node):
    assert node.get_action_iface().do_action(0), 'Native button action failed'


def overwrite():
    replace = button('Replace')
    if replace is None:
        return None
    parent = replace.get_parent()
    while parent is not None:
        if parent.get_role() in (Atspi.Role.DIALOG, Atspi.Role.ALERT):
            return parent
        parent = parent.get_parent()


for scenario in ['cancel', 'confirm']:
    wait_for(lambda: state().get('scenario') == scenario and state().get('phase') == 'dialog-open', 'Save operation did not start')
    click(wait_for(lambda: button('Save'), 'Native Save button missing'))
    confirmation = wait_for(overwrite, 'Existing file was accepted without a visible overwrite confirmation')
    labels = ' '.join(node.get_name() or '' for node in nodes(confirmation))
    assert 'edited.txt' in labels and ('already exists' in labels or 'replace' in labels.lower()), labels
    assert state() == {'scenario': scenario, 'phase': 'dialog-open'}, 'Save returned before overwrite confirmation'
    assert (root / 'edited.txt').read_text() == original, 'Destination changed before confirmation'
    subprocess.run(['scrot', str(root / ('overwrite-' + scenario + '.png'))], check=True)
    observations.append({'scenario': scenario, 'confirmation': labels, 'destinationPreservedBeforeConfirmation': True})
    click(wait_for(lambda: button('Cancel' if scenario == 'cancel' else 'Replace', confirmation), 'Confirmation action missing'))
    if scenario == 'cancel':
        wait_for(lambda: overwrite() is None, 'Overwrite confirmation did not close')
        # GTK returns to its chooser after declining overwrite. Cancel that
        # chooser too, if the backend has not already canceled the operation.
        if state() == {'scenario': scenario, 'phase': 'dialog-open'}:
            click(wait_for(lambda: button('Cancel'), 'Native chooser Cancel button missing'))

wait_for(lambda: state().get('phase') == 'done', 'Native save assertions did not finish')
(root / 'native-dialog-report.json').write_text(json.dumps({'overwriteDialogs': observations}, indent=2))
print(json.dumps({'nativeOverwriteConfirmations': len(observations)}))

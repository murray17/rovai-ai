"""Synthetic stdio MCP tool; generates each receipt only after tools/call."""
import json
import sys
import uuid
from pathlib import Path

receipt_path = Path(sys.argv[1])
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request.get('params', {}).get('protocolVersion', '2024-11-05'),
                  'capabilities': {'tools': {}}, 'serverInfo': {'name': 'shim72-receipt', 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'shim_receipt', 'description': 'Return a newly generated receipt for an isolated compaction experiment.',
                            'inputSchema': {'type': 'object', 'properties': {'phase': {'type': 'string'}}, 'required': ['phase'], 'additionalProperties': False}}]}
    elif method == 'tools/call' and request.get('params', {}).get('name') == 'shim_receipt':
        result_value = {'phase': request['params'].get('arguments', {}).get('phase'), 'receipt': str(uuid.uuid4())}
        with receipt_path.open('a') as stream:
            stream.write(json.dumps(result_value) + '\n')
        result = {'content': [{'type': 'text', 'text': json.dumps(result_value)}]}
    elif method == 'ping':
        result = {}
    else:
        print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32601, 'message': 'Unsupported method'}}), flush=True)
        continue
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)

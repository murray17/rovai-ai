"""Acceptance-only client of the official Gateway RPC; never constructs an agent."""
import asyncio
import contextlib
import json
import sys
from hermes_constants import get_hermes_home
from hermes_cli.gateway_runtime import attachable, discover_gateway_endpoint
from hermes_cli.gateway_client import connect_gateway

async def main():
    found = await asyncio.to_thread(discover_gateway_endpoint, get_hermes_home())
    if not attachable(found):
        raise RuntimeError(f"Dedicated owner not ready: {found.state}")
    async with connect_gateway(found.endpoint) as client:
        async def drain():
            while True:
                frame = await client.events.get()
                if isinstance(frame, Exception):
                    raise frame
                print(json.dumps({'method': 'gateway/event', 'params': frame}), flush=True)
        consumer = asyncio.create_task(drain())
        try:
            while line := await asyncio.to_thread(sys.stdin.readline):
                request = json.loads(line)
                try:
                    result = await client.rpc(request['method'], **request.get('params', {}))
                    answer = {'id': request['id'], 'result': result}
                except Exception as error:
                    answer = {'id': request['id'], 'error': {'type': type(error).__name__, 'message': str(error)}}
                print(json.dumps(answer), flush=True)
        finally:
            consumer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await consumer

asyncio.run(main())

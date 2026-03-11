import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://ris-live.ripe.net/v1/ws/") as ws:
        msg = {"type": "ris_subscribe"}
        await ws.send(json.dumps(msg))
        count = 0
        for _ in range(50):
            res = await ws.recv()
            count += 1
        print(f"Received {count} messages with no data filter")

asyncio.run(test())

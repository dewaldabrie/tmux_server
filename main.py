import os
import pty
import asyncio
import libtmux
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
tmux_server = libtmux.Server()

class SessionCreate(BaseModel):
    name: str

@app.get("/api/sessions")
async def list_sessions():
    try:
        # Refresh sessions
        sessions = tmux_server.sessions
        result = []
        for s in sessions:
            pane = s.active_pane
            width, height = 80, 24 # Defaults
            if pane:
                width = int(pane.width)
                height = int(pane.height)
            result.append({
                "name": s.name,
                "width": width,
                "height": height
            })
        return result
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        return []

@app.post("/api/sessions")
async def create_session(session: SessionCreate):
    logger.info(f"Creating session: {session.name}")
    try:
        # Use attach_if_exists to avoid 400 if session exists
        tmux_server.new_session(session_name=session.name, attach_if_exists=True)
        return {"status": "success", "session": session.name}
    except Exception as e:
        logger.error(f"Error creating session '{session.name}': {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))

@app.websocket("/ws/session/{session_name}")
async def session_websocket(websocket: WebSocket, session_name: str):
    logger.info(f"WebSocket connection attempt for session: {session_name}")
    await websocket.accept()
    logger.info(f"WebSocket accepted for session: {session_name}")
    
    try:
        # Refresh server state
        sessions = tmux_server.sessions
        logger.info(f"Available sessions: {[s.name for s in sessions]}")
        
        session = tmux_server.sessions.get(session_name=session_name)
        if not session:
            logger.warning(f"Session {session_name} not found.")
            await websocket.send_text(f"\r\nSession {session_name} not found.\r\n")
            await websocket.close()
            return
        
        pane = session.active_pane
        if not pane:
            logger.warning(f"No active pane found for session {session_name}.")
            await websocket.send_text("\r\nNo active pane found.\r\n")
            await websocket.close()
            return

        logger.info(f"Starting terminal bridge for session {session_name}, pane {pane.id}")

        stop_event = asyncio.Event()
        last_content = None

        async def capture_loop():
            nonlocal last_content
            logger.info(f"Capture loop started for session {session_name}")
            while not stop_event.is_set():
                try:
                    # Capture history (last 200 lines)
                    lines = pane.capture_pane(escape_sequences=True, start="-200")
                    content = "\r\n".join(lines)
                    
                    # Get cursor position
                    cursor_x = int(pane.cursor_x)
                    cursor_y = int(pane.cursor_y)
                    # cursor_y from libtmux is relative to the VIEWPORT.
                    # We need it relative to the captured content.
                    # In tmux, the cursor_y is 0-indexed within the pane.
                    # Our 'lines' contains history + pane.
                    # If pane height is H, and we captured S lines of history,
                    # the cursor is at S + cursor_y.
                    # Let's just send the raw values and calculate on frontend or here.
                    
                    # For simplicity, send a JSON object
                    update = {
                        "type": "update",
                        "content": content,
                        "cursor_x": cursor_x,
                        "cursor_y": cursor_y,
                        "history_len": len(lines) - int(pane.height)
                    }
                    
                    # Only send if content or cursor changed
                    if content != last_content:
                        await websocket.send_json(update)
                        last_content = content
                    
                    await asyncio.sleep(0.2) 
                except Exception as e:
                    logger.error(f"Capture loop error in session {session_name}: {e}", exc_info=True)
                    break
            logger.info(f"Capture loop exiting for session {session_name}")
            stop_event.set()

        async def input_loop():
            logger.info(f"Input loop started for session {session_name}")
            try:
                import json
                while not stop_event.is_set():
                    try:
                        data = await websocket.receive_bytes()
                        if not data:
                            logger.info(f"Empty data received in session {session_name}")
                            continue

                        # Check if message is a JSON resize event
                        if len(data) > 0 and data[0] == ord('{'):
                            try:
                                msg = json.loads(data.decode("utf-8"))
                                if msg.get("type") == "resize":
                                    cols, rows = msg.get("cols"), msg.get("rows")
                                    if cols and rows:
                                        logger.info(f"Resizing session {session_name} to {cols}x{rows}")
                                        tmux_server.cmd("resize-window", "-t", session_name, "-x", str(cols), "-y", str(rows))
                                    continue
                            except json.JSONDecodeError:
                                pass # Not JSON, treat as keys

                        keys = data.decode("utf-8")
                        pane.send_keys(keys, enter=False, literal=True)
                    except WebSocketDisconnect:
                        logger.info(f"WebSocket disconnected for session {session_name}")
                        break
                    except Exception as e:
                        logger.error(f"Input error in session {session_name}: {e}", exc_info=True)
            except Exception as e:
                logger.error(f"Input loop fatal error in session {session_name}: {e}", exc_info=True)
            finally:
                logger.info(f"Input loop exiting for session {session_name}")
                stop_event.set()

        tasks = [
            asyncio.create_task(capture_loop()),
            asyncio.create_task(input_loop())
        ]
        
        await stop_event.wait()
        
        for t in tasks:
            t.cancel()
            
    except Exception as e:
        logger.error(f"Session WebSocket error: {e}")
        try:
            await websocket.send_text(f"\r\nError: {str(e)}\r\n")
        except:
            pass

# Ensure static exists and mount it
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Use 0.0.0.0 for Tailscale access
    uvicorn.run(app, host="0.0.0.0", port=8888)

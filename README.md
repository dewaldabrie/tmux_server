# tmux-server

A FastAPI-based bridge that exposes tmux sessions over WebSockets, providing a web-based terminal interface.

## Overview

`tmux-server` allows you to interact with tmux sessions through a web browser. It uses `libtmux` to manage sessions and FastAPI with WebSockets to stream terminal output and receive input.

## Getting Started

### Prerequisites

- Python 3.13+
- tmux installed on the system

### Local Setup

1. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -e .
   ```

3. **Run the server:**
   ```bash
   python main.py
   ```

The server will be available at `http://localhost:8888`.

## Usage

Once the server is running, you can access the web interface to list, create, and attach to tmux sessions.

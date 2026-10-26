# Pi Deck polling and process cleanup

The Pi extension keeps one Deck poll in flight. On timeout or session close, it attempts to stop the process it started and its descendants. On Windows, cleanup uses taskkill for that process tree. A detached process may escape this cleanup.

The change is generated from templates/pi/edu.ts and does not activate a global installation. Protocol tests cover Pi 1.4.0 and Windows descendant cleanup. This behavior does not guarantee cleanup of all processes started by other CLIs.

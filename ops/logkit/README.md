# logkit (vendored)
Zero-dependency structured logging, canonical copy /home/flori/tools/logkit (logging standard, AGENTS.md).
Loaded with `node -r ./logkit/logkit-preload.cjs server.js` in the Dockerfile: JSON console lines, crash stacks,
one `http.request` line per request with request id. LOG_IP=0 / LOG_UA=0: no IPs or user agents in logs.

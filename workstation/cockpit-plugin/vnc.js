/* Server Monitor — Desktop (VNC) Sub-tab (workstation only) */
/* Depends on: utils.js (SM namespace) */
/* Bridge backend: /sysmon/desktop/* (noVNC + websockify on host) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;

    // Tailscale serve가 매핑한 path. Cockpit plugin context는 same-origin이므로
    // 절대 경로(`/sysmon/desktop/...`)로 부모 호스트의 noVNC asset을 가리킨다.
    var VNC_HTML  = "/sysmon/desktop/vnc.html";
    var WS_PATH   = "sysmon/desktop/websockify";  // websockify가 listening하는 ws path (vnc.html 내부 옵션)
    var EMBED_QS  = "?path=" + encodeURIComponent(WS_PATH) + "&autoconnect=1&resize=scale&reconnect=1";

    function setStatus(text) {
        var el = $("vnc-embed-status");
        if (el) el.textContent = text;
    }

    function init() {
        var startBtn = $("vnc-embed-start");
        var stopBtn  = $("vnc-embed-stop");
        var frame    = $("vnc-frame");
        var wrap     = $("vnc-frame-container");
        if (!startBtn || !frame || !wrap) return;

        startBtn.addEventListener("click", function() {
            frame.src = VNC_HTML + EMBED_QS;
            wrap.style.display = "";
            startBtn.style.display = "none";
            stopBtn.style.display  = "";
            setStatus("연결 중 (Tailscale → :6080 → :5900)");
        });

        stopBtn.addEventListener("click", function() {
            // about:blank로 set하면 iframe 안에서 noVNC가 disconnect 후 GC됨
            frame.src = "about:blank";
            wrap.style.display = "none";
            stopBtn.style.display  = "none";
            startBtn.style.display = "";
            setStatus("중지됨");
        });
    }

    SM.registerModule("desktop", init);
})();

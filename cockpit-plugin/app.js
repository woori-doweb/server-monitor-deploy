/* Server Monitor - Cockpit Plugin */
/* External JS for CSP compliance */

(function() {
    "use strict";

    var CIRCUMFERENCE = 2 * Math.PI * 42; // ~264

    var SERVICES = [
        { name: "httpd", label: "Apache httpd" },
        { name: "netdata", label: "Netdata" },
        { name: "mariadb", label: "MariaDB" },
        { name: "cockpit.socket", label: "Cockpit" },
        { name: "certbot-renew.timer", label: "Certbot Timer" },
        { name: "firewalld", label: "Firewall" },
        { name: "sshd", label: "SSH" },
        { name: "crond", label: "Cron" }
    ];

    function $(id) { return document.getElementById(id); }

    function setRing(id, pct) {
        var el = $(id);
        if (!el) return;
        var offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
        el.setAttribute("stroke-dashoffset", offset);
    }

    function setBar(id, pct) {
        var el = $(id);
        if (el) el.style.width = pct + "%";
    }

    function setText(id, val) {
        var el = $(id);
        if (el) el.textContent = val;
    }

    function formatBytes(kb) {
        if (kb >= 1048576) return (kb / 1048576).toFixed(1) + " GB";
        if (kb >= 1024) return (kb / 1024).toFixed(1) + " MB";
        return kb + " KB";
    }

    function formatUptime(seconds) {
        var d = Math.floor(seconds / 86400);
        var h = Math.floor((seconds % 86400) / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return d + "d " + h + "h";
        if (h > 0) return h + "h " + m + "m";
        return m + "m";
    }

    function escapeHtml(str) {
        var div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    function statusBadge(state) {
        if (state === "active" || state === "running" || state === "waiting")
            return '<span class="badge badge-ok">active</span>';
        if (state === "failed")
            return '<span class="badge badge-crit">failed</span>';
        if (state === "inactive" || state === "dead")
            return '<span class="badge badge-inactive">inactive</span>';
        return '<span class="badge badge-warn">' + escapeHtml(state) + "</span>";
    }

    /* ── Server Info ── */
    function updateServerInfo() {
        cockpit.spawn(["hostname"]).then(function(h) {
            cockpit.spawn(["cat", "/etc/os-release"]).then(function(os) {
                var name = "";
                os.split("\n").forEach(function(line) {
                    if (line.indexOf("PRETTY_NAME=") === 0)
                        name = line.split("=")[1].replace(/"/g, "");
                });
                setText("server-info", h.trim() + " | " + name);
            });
        });
    }

    /* ── CPU ── */
    var prevCpu = null;
    function updateCPU() {
        cockpit.spawn(["cat", "/proc/stat"]).then(function(data) {
            var line = data.split("\n")[0].split(/\s+/);
            var cur = {
                user: parseInt(line[1]) + parseInt(line[2]),
                sys: parseInt(line[3]),
                idle: parseInt(line[4]),
                iowait: parseInt(line[5]),
                total: 0
            };
            cur.total = cur.user + cur.sys + cur.idle + cur.iowait +
                        parseInt(line[6]) + parseInt(line[7]);

            if (prevCpu) {
                var dt = cur.total - prevCpu.total;
                if (dt > 0) {
                    var userPct = ((cur.user - prevCpu.user) / dt * 100).toFixed(1);
                    var sysPct = ((cur.sys - prevCpu.sys) / dt * 100).toFixed(1);
                    var ioPct = ((cur.iowait - prevCpu.iowait) / dt * 100).toFixed(1);
                    var idlePct = (cur.idle - prevCpu.idle) / dt * 100;
                    var usedPct = (100 - idlePct).toFixed(1);

                    setText("cpu-pct", usedPct + "%");
                    setText("cpu-ring-val", Math.round(usedPct) + "%");
                    setText("cpu-user", userPct + "%");
                    setText("cpu-sys", sysPct + "%");
                    setText("cpu-iowait", ioPct + "%");
                    setRing("cpu-ring", parseFloat(usedPct));
                    setBar("cpu-bar", parseFloat(usedPct));
                }
            }
            prevCpu = cur;
        });

        cockpit.spawn(["nproc"]).then(function(n) { setText("cpu-cores", n.trim()); });
        cockpit.spawn(["sh", "-c", "grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2"]).then(function(m) {
            setText("cpu-model", m.trim().replace(/\s+/g, " ").substring(0, 30));
        });
    }

    /* ── Memory ── */
    function updateMemory() {
        cockpit.spawn(["cat", "/proc/meminfo"]).then(function(data) {
            var info = {};
            data.split("\n").forEach(function(line) {
                var parts = line.split(/:\s+/);
                if (parts.length >= 2) info[parts[0]] = parseInt(parts[1]);
            });

            var total = info["MemTotal"] || 0;
            var free = info["MemFree"] || 0;
            var buffers = info["Buffers"] || 0;
            var cached = info["Cached"] || 0;
            var slab = info["SReclaimable"] || 0;
            var used = total - free - buffers - cached - slab;
            var pct = total > 0 ? (used / total * 100).toFixed(1) : 0;

            var swapTotal = info["SwapTotal"] || 0;
            var swapFree = info["SwapFree"] || 0;
            var swapUsed = swapTotal - swapFree;

            var available = info["MemAvailable"];
            if (available === undefined) available = free + buffers + cached + slab;
            var availablePct = total > 0 ? (available / total * 100) : 0;
            var swapUsedMB = swapUsed / 1024;

            setText("mem-pct", pct + "%");
            setText("mem-ring-val", Math.round(pct) + "%");
            setText("mem-total", formatBytes(total));
            setText("mem-used", formatBytes(used));
            setText("mem-free", formatBytes(free));
            setText("mem-cache", formatBytes(buffers + cached));
            setText("swap-used", formatBytes(swapUsed) + " / " + formatBytes(swapTotal));
            setRing("mem-ring", parseFloat(pct));
            setBar("mem-bar", parseFloat(pct));

            // Advisor key metrics
            setText("mem-available", formatBytes(available));
            setText("mem-available-pct", availablePct.toFixed(0) + "%");
            setText("mem-swap-detail", formatBytes(swapUsed) + " / " + formatBytes(swapTotal));

            var pressure, pressureClass;
            if (swapUsedMB < 50) { pressure = "압박 없음"; pressureClass = "ok"; }
            else if (swapUsedMB < 1024) { pressure = "경미 (" + Math.round(swapUsedMB) + " MB)"; pressureClass = "warn"; }
            else { pressure = "심각 (" + (swapUsedMB / 1024).toFixed(1) + " GB)"; pressureClass = "crit"; }
            var pressureEl = $("mem-swap-pressure");
            if (pressureEl) {
                pressureEl.textContent = pressure;
                pressureEl.className = "advisor-pressure-" + pressureClass;
            }

            // Verdict
            var verdict, verdictClass, reason;
            if (availablePct < 15 || swapUsedMB > 1024) {
                verdict = "경고";
                verdictClass = "advisor-crit";
                reason = "즉시 사용 가능 메모리 " + availablePct.toFixed(0) + "%" +
                         (swapUsedMB > 1024 ? ", 스왑 " + (swapUsedMB / 1024).toFixed(1) + " GB 사용" : "") +
                         " — 메모리 압박 징후, 원인 확인 필요.";
            } else if (availablePct < 30 || swapUsedMB > 200) {
                verdict = "주의";
                verdictClass = "advisor-warn";
                reason = "즉시 사용 가능 메모리 " + availablePct.toFixed(0) + "%" +
                         (swapUsedMB > 200 ? ", 스왑 " + Math.round(swapUsedMB) + " MB 사용" : "") +
                         " — 여유 감소, 관찰 권장.";
            } else {
                verdict = "정상";
                verdictClass = "advisor-ok";
                reason = "즉시 사용 가능 " + availablePct.toFixed(0) + "% (" + formatBytes(available) +
                         "), 스왑 " + (swapUsedMB < 1 ? "미사용" : Math.round(swapUsedMB) + " MB") +
                         " — 안정적. used " + pct + "%는 워킹셋+캐시 포함 수치이며 문제 아님.";
            }
            var banner = $("mem-advisor-banner");
            if (banner) {
                banner.className = "advisor-banner " + verdictClass;
                banner.innerHTML = '<span class="advisor-badge">' + verdict + '</span>' +
                                   '<span class="advisor-reason">' + escapeHtml(reason) + '</span>';
            }
        });
    }

    /* ── Memory Advisor: Top processes + by-user aggregation ── */
    function updateMemoryAdvisor() {
        cockpit.spawn(["ps", "-eo", "user:20,pid,rss,%mem,comm", "--no-headers", "--sort=-rss"]).then(function(data) {
            var lines = data.trim().split("\n");
            var byUser = {};
            var top = [];

            lines.forEach(function(line, idx) {
                var parts = line.trim().split(/\s+/);
                if (parts.length < 5) return;
                var user = parts[0];
                var pid = parts[1];
                var rss = parseInt(parts[2]);  // KB
                var memPct = parts[3];
                var cmd = parts.slice(4).join(" ");
                if (isNaN(rss)) return;

                byUser[user] = (byUser[user] || 0) + rss;
                if (idx < 10) top.push({ user: user, pid: pid, rss: rss, pct: memPct, cmd: cmd });
            });

            // Top procs table
            var topHtml = '<table class="proc-table">' +
                '<thead><tr><th>USER</th><th>PID</th><th class="num">RSS</th><th class="num">%MEM</th><th>COMMAND</th></tr></thead><tbody>';
            top.forEach(function(p) {
                var cmdShort = p.cmd.length > 60 ? p.cmd.substring(0, 57) + "..." : p.cmd;
                topHtml += '<tr>' +
                    '<td>' + escapeHtml(p.user) + '</td>' +
                    '<td>' + escapeHtml(p.pid) + '</td>' +
                    '<td class="num">' + formatBytes(p.rss) + '</td>' +
                    '<td class="num">' + escapeHtml(p.pct) + '%</td>' +
                    '<td>' + escapeHtml(cmdShort) + '</td>' +
                '</tr>';
            });
            topHtml += '</tbody></table>';
            $("mem-top-procs").innerHTML = topHtml;

            // By-user aggregate: pick top 8 users, filter users with >30 MB
            var userList = Object.keys(byUser).map(function(u) {
                return { user: u, rss: byUser[u] };
            }).filter(function(x) {
                return x.rss > 30 * 1024;  // >30 MB
            }).sort(function(a, b) { return b.rss - a.rss; }).slice(0, 8);

            var maxRss = userList.length > 0 ? userList[0].rss : 1;
            var userHtml = "";
            userList.forEach(function(u) {
                var pct = (u.rss / maxRss * 100).toFixed(0);
                userHtml += '<div class="user-bar-row">' +
                    '<span class="user-bar-label">' + escapeHtml(u.user) + '</span>' +
                    '<div class="user-bar-track"><div class="user-bar-fill" style="width:' + pct + '%"></div></div>' +
                    '<span class="user-bar-value">' + formatBytes(u.rss) + '</span>' +
                '</div>';
            });
            $("mem-by-user").innerHTML = userHtml || '<div class="muted">데이터 없음</div>';
        }).fail(function(err) {
            $("mem-top-procs").innerHTML = '<div class="muted">ps 조회 실패</div>';
            $("mem-by-user").innerHTML = '<div class="muted">ps 조회 실패</div>';
        });
    }

    /* ── Disk ── */
    function updateDisk() {
        cockpit.spawn(["df", "-h", "--output=target,size,used,avail,pcent",
                        "-x", "tmpfs", "-x", "devtmpfs", "-x", "overlay"]).then(function(data) {
            var lines = data.trim().split("\n").slice(1);
            var html = "";
            var firstPct = "";

            lines.forEach(function(line) {
                var parts = line.trim().split(/\s+/);
                if (parts.length >= 5) {
                    var mount = parts[0];
                    var size = parts[1];
                    var used = parts[2];
                    var avail = parts[3];
                    var pct = parseInt(parts[4]);

                    if (!firstPct) {
                        firstPct = pct;
                        setText("disk-pct", pct + "%");
                        setBar("disk-bar", pct);
                    }

                    var barClass = pct >= 90 ? "red" : pct >= 70 ? "orange" : "green";

                    html += '<div class="disk-entry">' +
                        '<div class="disk-header">' +
                            '<span class="disk-mount">' + escapeHtml(mount) + '</span>' +
                            '<span class="disk-size">' + escapeHtml(used) + ' / ' + escapeHtml(size) + '</span>' +
                        '</div>' +
                        '<div class="progress"><div class="progress-fill ' + barClass +
                            '" style="width:' + pct + '%"></div></div>' +
                        '<div class="disk-footer">' + pct + '% | ' + escapeHtml(avail) + ' free</div>' +
                    '</div>';
                }
            });

            $("disk-list").innerHTML = html || '<div class="muted">No data</div>';
        });
    }

    /* ── Services ── */
    function updateServices() {
        var results = [];
        var pending = SERVICES.length + 1; // +1 for PM2

        function render() {
            var html = "";
            results.forEach(function(r) {
                html += '<div class="svc-row">' +
                    '<span class="svc-name">' + r.label + '</span>' +
                    '<div class="svc-right">' +
                        '<span class="svc-id">' + r.name + '</span>' +
                        statusBadge(r.state) +
                    '</div></div>';
            });
            $("service-list").innerHTML = html;
        }

        SERVICES.forEach(function(svc) {
            cockpit.spawn(["systemctl", "is-active", svc.name]).then(function(state) {
                results.push({ label: svc.label, name: svc.name, state: state.trim() });
                pending--;
                if (pending <= 0) render();
            }).fail(function() {
                results.push({ label: svc.label, name: svc.name, state: "inactive" });
                pending--;
                if (pending <= 0) render();
            });
        });

        cockpit.spawn(["sh", "-c", "pm2 pid uptime-kuma 2>/dev/null || echo 0"]).then(function(pid) {
            pid = pid.trim();
            var state = (pid && pid !== "0" && pid !== "") ? "active" : "inactive";
            results.push({ label: "Uptime Kuma", name: "pm2:uptime-kuma", state: state });
            pending--;
            if (pending <= 0) render();
        }).fail(function() {
            results.push({ label: "Uptime Kuma", name: "pm2:uptime-kuma", state: "inactive" });
            pending--;
            if (pending <= 0) render();
        });
    }

    /* ── Network ── */
    var prevNet = {};
    function updateNetwork() {
        cockpit.spawn(["cat", "/proc/net/dev"]).then(function(data) {
            var lines = data.trim().split("\n").slice(2);
            var html = "";

            lines.forEach(function(line) {
                var parts = line.trim().split(/[\s:]+/);
                if (parts.length >= 10) {
                    var iface = parts[0];
                    if (iface === "lo") return;

                    var rxBytes = parseInt(parts[1]);
                    var txBytes = parseInt(parts[9]);
                    var rxRate = "--", txRate = "--";

                    if (prevNet[iface]) {
                        var dt = 3;
                        rxRate = formatBytes(Math.round((rxBytes - prevNet[iface].rx) / dt)) + "/s";
                        txRate = formatBytes(Math.round((txBytes - prevNet[iface].tx) / dt)) + "/s";
                    }
                    prevNet[iface] = { rx: rxBytes, tx: txBytes };

                    html += '<div class="net-row">' +
                        '<span class="net-iface">' + escapeHtml(iface) + '</span>' +
                        '<div class="net-stats">' +
                            '<div class="net-col">' +
                                '<div class="net-label">RX</div>' +
                                '<div class="net-rx">' + rxRate + '</div>' +
                                '<div class="net-total">' + formatBytes(Math.round(rxBytes/1024)) + '</div>' +
                            '</div>' +
                            '<div class="net-col">' +
                                '<div class="net-label">TX</div>' +
                                '<div class="net-tx">' + txRate + '</div>' +
                                '<div class="net-total">' + formatBytes(Math.round(txBytes/1024)) + '</div>' +
                            '</div>' +
                        '</div></div>';
                }
            });

            $("net-list").innerHTML = html || '<div class="muted">No interfaces</div>';
        });
    }

    /* ── Uptime + Load ── */
    function updateUptime() {
        cockpit.spawn(["cat", "/proc/uptime"]).then(function(data) {
            setText("uptime-val", formatUptime(parseFloat(data.split(" ")[0])));
        });
        cockpit.spawn(["cat", "/proc/loadavg"]).then(function(data) {
            var p = data.split(" ");
            setText("load-avg", "Load: " + p[0] + " / " + p[1] + " / " + p[2]);
        });
    }

    /* ── Timestamp ── */
    function updateTimestamp() {
        var now = new Date();
        setText("update-time", now.toLocaleTimeString("ko-KR"));
    }

    /* ── Init ── */
    function refresh() {
        updateCPU();
        updateMemory();
        updateDisk();
        updateNetwork();
        updateUptime();
        updateTimestamp();
    }

    updateServerInfo();
    updateServices();
    updateMemoryAdvisor();
    updateCPU(); // first read for delta baseline

    setTimeout(function() {
        refresh();
        setInterval(refresh, 3000);
        setInterval(updateServices, 30000);
        setInterval(updateMemoryAdvisor, 15000);
    }, 1000);

    /* ── Tab Navigation ── */
    var tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach(function(tabBtn) {
        tabBtn.addEventListener("click", function() {
            var target = tabBtn.getAttribute("data-tab");
            tabBtns.forEach(function(b) { b.classList.remove("active"); });
            document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
            tabBtn.classList.add("active");
            var el = document.getElementById("tab-" + target);
            if (el) el.classList.add("active");
        });
    });

})();

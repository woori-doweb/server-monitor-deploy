/* Server Monitor - Scheduled Reboot */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var POLL_INTERVAL = 30000;
    var pollTimer = null;

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    function fmtKR(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function loadStatus() {
        var c = $("reboot-status");
        var cancelBtn = $("reboot-cancel-btn");
        if (!c) return;

        cockpit.spawn(["sh", "-c",
            "test -e /run/systemd/shutdown/scheduled && cat /run/systemd/shutdown/scheduled || echo NONE"],
            { superuser: "try" })
            .then(function(out) {
                if (out.trim() === "NONE") {
                    c.innerHTML = '<div class="muted">예약된 재시작 없음</div>';
                    if (cancelBtn) cancelBtn.style.display = "none";
                    return;
                }
                var usecMatch = out.match(/USEC=(\d+)/);
                var modeMatch = out.match(/MODE=([a-z]+)/);
                var whenStr = "(unknown)";
                var minutesLeft = "?";
                if (usecMatch) {
                    var d = new Date(parseInt(usecMatch[1], 10) / 1000);
                    whenStr = fmtKR(d);
                    var diffMs = d.getTime() - Date.now();
                    minutesLeft = Math.max(0, Math.round(diffMs / 60000));
                }
                c.innerHTML = '<div class="result-box result-warn"><strong>재시작 예약됨</strong><br>' +
                    '시각: <code>' + SM.escapeHtml(whenStr) + '</code><br>' +
                    '남은 시간: 약 ' + minutesLeft + '분 후<br>' +
                    '모드: ' + SM.escapeHtml(modeMatch ? modeMatch[1] : "?") + '</div>';
                if (cancelBtn) cancelBtn.style.display = "inline-block";
            })
            .fail(function(err) {
                c.innerHTML = '<div class="result-box result-error">상태 조회 실패: ' +
                    SM.escapeHtml(SM.errMsg(err)) + '</div>';
                if (cancelBtn) cancelBtn.style.display = "none";
            });
    }

    function scheduleReboot() {
        SM.clearErrors("reboot");
        var datetime = ($("reboot-when") || {}).value || "";
        var reason = (($("reboot-reason") || {}).value || "").trim();
        var btn = $("reboot-submit");

        if (!datetime) {
            SM.showError("reboot-when-error", "재시작 시각을 선택해 주세요");
            return;
        }
        var target = new Date(datetime);
        if (isNaN(target.getTime())) {
            SM.showError("reboot-when-error", "올바른 시각이 아닙니다");
            return;
        }
        var diffMs = target.getTime() - Date.now();
        if (diffMs < 60000) {
            SM.showError("reboot-when-error", "현재 시각으로부터 최소 1분 뒤로 지정해 주세요");
            return;
        }
        if (diffMs > 7 * 24 * 60 * 60 * 1000) {
            SM.showError("reboot-when-error", "7일 이내로 지정해 주세요");
            return;
        }
        if (reason.length > 80) {
            SM.showError("reboot-when-error", "사유는 80자 이내");
            return;
        }
        if (!/^[\x20-\x7E가-힣ㄱ-ㆎ]*$/.test(reason)) {
            SM.showError("reboot-when-error", "사유에 특수문자(개행 등) 포함 불가");
            return;
        }

        var minutes = Math.round(diffMs / 60000);
        var msg = "Scheduled via Cockpit Server Monitor";
        if (reason) msg += " — " + reason;

        SM.confirmDialog("Schedule Reboot",
            "예약 시각: " + fmtKR(target) + "\n" +
            "지금부터: 약 " + minutes + "분 후\n" +
            "사유: " + (reason || "(없음)") + "\n\n" +
            "재부팅 직전에 모든 SSH 사용자에게 wall 메시지가 broadcast 됩니다.\n" +
            "예약 후에도 같은 카드의 Cancel 버튼으로 취소 가능합니다.")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["shutdown", "-r", "+" + minutes, msg], { superuser: "require" })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("REBOOT_SCHEDULE",
                            "in " + minutes + "min @ " + fmtKR(target) + " reason=" + (reason || "(none)"));
                        SM.showResult("reboot-result", true,
                            "재시작 예약됨 — 약 " + minutes + "분 후");
                        loadStatus();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("reboot-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function cancelReboot() {
        SM.confirmDialog("Cancel Scheduled Reboot",
            "예약된 재시작을 취소합니다. 진행할까요?")
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn(["shutdown", "-c"], { superuser: "require" })
                    .then(function() {
                        SM.logAction("REBOOT_CANCEL", "cancelled by operator");
                        SM.showResult("reboot-result", true, "재시작 예약이 취소되었습니다");
                        loadStatus();
                    })
                    .fail(function(err) {
                        SM.showResult("reboot-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function setDefaultDateTime() {
        var inp = $("reboot-when");
        if (!inp) return;
        var d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(3, 0, 0, 0);
        inp.value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
        var minD = new Date(Date.now() + 60000);
        inp.min = minD.getFullYear() + "-" + pad(minD.getMonth() + 1) + "-" + pad(minD.getDate()) +
            "T" + pad(minD.getHours()) + ":" + pad(minD.getMinutes());
        var maxD = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        inp.max = maxD.getFullYear() + "-" + pad(maxD.getMonth() + 1) + "-" + pad(maxD.getDate()) +
            "T" + pad(maxD.getHours()) + ":" + pad(maxD.getMinutes());
    }

    function initReboot() {
        setDefaultDateTime();
        loadStatus();
        if (!pollTimer) pollTimer = setInterval(loadStatus, POLL_INTERVAL);
        SM.bindSubmit("reboot-form", scheduleReboot);
        SM.bindClick("reboot-cancel-btn", cancelReboot);
        SM.bindClick("reboot-refresh", loadStatus);
    }

    SM.registerModule("reboot", initReboot);

})();

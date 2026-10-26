'use strict';

const PHASE = {
  FOCUS: 'focus',
  IDLE: 'idle',
  BREAK: 'break',
  PAUSED: 'paused',
};

const FREEZE = { NONE: null, IDLE: 'idle', LOCK: 'lock', MANUAL: 'manual' };

const DEFAULT_CONFIG = {
  intervalMin: 45,
  breakMin: 5,
  snoozeMin: 5,
  prewarnSec: 60,
  sound: true,
  idlePause: true,
  idleThresholdMin: 3,
  lockPostpone: true,
  forceOverlay: true,
  autostart: false,
  theme: 'auto',
};

const CONFIG_LIMITS = {
  intervalMin: [15, 180],
  breakMin: [1, 30],
  snoozeMin: [1, 30],
  idleThresholdMin: [1, 30],
};

const DAY_MS = 86400000;
const HISTORY_DAYS = 14;
/** 休息满这么久之后，才允许用「人离开键盘」提前判定起身完成 */
const BREAK_AWAY_MIN_MS = 2 * 60000;

function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function emptyDay() {
  return { focusSec: 0, breaksDone: 0, breaksSkipped: 0, snoozes: 0, longestFocusSec: 0, hourly: new Array(24).fill(0) };
}

function clampConfig(name, value) {
  const limit = CONFIG_LIMITS[name];
  if (!limit) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG[name];
  return Math.min(limit[1], Math.max(limit[0], n));
}

/**
 * 久坐提醒计时引擎。纯逻辑：所有时间通过 tick(now, idleSec) 注入，
 * 因此可以不依赖 Electron 单独跑。
 */
class Engine {
  constructor({ now = Date.now(), config = {}, saved = null, onEvent = () => {} }) {
    this.onEvent = onEvent;
    this.config = { ...DEFAULT_CONFIG };
    this.applyConfig(config, { silent: true });

    this.stats = { todayKey: dayKey(now), today: emptyDay(), history: {} };
    this.state = { phase: PHASE.FOCUS, cycleStartAt: now, nextDueAt: now + this.intervalMs(), breakStartAt: 0, breakEndAt: 0, lastBreakAt: 0 };
    this.freeze = { reason: FREEZE.NONE, at: 0 };
    this.lastPrewarnAt = 0;
    this.lastTickAt = now;
    this.lastRealNow = now;
    this.maxTickDeltaMs = 5000;
    this.sleepGapMs = 10 * 60 * 1000;

    if (saved) this.hydrate(saved, now);
  }

  intervalMs() { return this.config.intervalMin * 60000; }
  breakMs() { return this.config.breakMin * 60000; }

  /** 系统闲置秒数超过阈值 => 视为人已离开，冻结计时 */
  get idleThresholdSec() { return this.config.idleThresholdMin * 60; }

  hydrate(saved, now) {
    if (saved.config) this.applyConfig(saved.config, { silent: true });
    if (saved.state) Object.assign(this.state, saved.state);
    if (saved.freeze) Object.assign(this.freeze, saved.freeze);
    if (saved.stats) {
      this.stats.history = saved.stats.history || {};
      this.stats.today = { ...emptyDay(), ...(saved.stats.today || {}) };
      this.stats.today.hourly = (saved.stats.today && saved.stats.today.hourly) || new Array(24).fill(0);
      this.stats.todayKey = saved.stats.todayKey || dayKey(now);
    }
    this.rollDayIfNeeded(now);

    if (this.state.phase === PHASE.PAUSED) {
      // 手动暂停跨重启保留，等用户自己恢复
    } else if (this.state.phase === PHASE.BREAK) {
      // 休息中重启：剩余时间已经不多就直接收尾，否则继续
      if (this.state.breakEndAt <= now) this.completeBreak(now, 'restart');
    } else if (this.state.nextDueAt <= now) {
      const overdueSec = (now - this.state.nextDueAt) / 1000;
      // 错过太久（关应用/睡眠期间）不补罚，顺延一个完整周期
      if (overdueSec <= 120) this.startBreak(now, { overdueSec });
      else this.beginCycle(now);
    } else if (this.freeze.reason === FREEZE.LOCK) {
      // 锁屏事件可能丢失，用闲置兜底
      this.freeze = { reason: FREEZE.NONE, at: 0 };
      this.beginCycle(now);
    }
    this.lastTickAt = now;
  }

  applyConfig(patch, { silent = false } = {}) {
    const before = { ...this.config };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (patch && patch[key] !== undefined) {
        this.config[key] = CONFIG_LIMITS[key] ? clampConfig(key, patch[key]) : patch[key];
      }
    }
    if (!silent && this.config.intervalMin !== before.intervalMin && this.state.phase === PHASE.FOCUS) {
      // 改间隔时保持已消耗的比例，避免刚改完立刻弹提醒
      const total = before.intervalMin * 60000;
      const spent = Math.max(0, Math.min(total, this.state.nextDueAt - this.lastRealNow));
      this.state.nextDueAt = this.lastRealNow + Math.round((spent / total) * this.intervalMs());
    }
    return this.config;
  }

  rollDayIfNeeded(now) {
    const key = dayKey(now);
    if (key === this.stats.todayKey) return false;
    this.stats.history[this.stats.todayKey] = {
      focusSec: this.stats.today.focusSec,
      breaksDone: this.stats.today.breaksDone,
      breaksSkipped: this.stats.today.breaksSkipped,
      snoozes: this.stats.today.snoozes,
      longestFocusSec: this.stats.today.longestFocusSec,
    };
    const keys = Object.keys(this.stats.history).sort();
    while (keys.length > HISTORY_DAYS) {
      delete this.stats.history[keys.shift()];
    }
    this.stats.todayKey = key;
    this.stats.today = emptyDay();
    this.onEvent({ type: 'day-rollover', day: key });
    return true;
  }

  beginCycle(now) {
    this.state.phase = PHASE.FOCUS;
    this.state.cycleStartAt = now;
    this.state.nextDueAt = now + this.intervalMs();
    this.state.breakStartAt = 0;
    this.state.breakEndAt = 0;
    this.freeze = { reason: FREEZE.NONE, at: 0 };
    this.lastPrewarnAt = 0;
  }

  startBreak(now, meta = {}) {
    this.state.phase = PHASE.BREAK;
    this.state.breakStartAt = now;
    this.state.breakEndAt = now + this.breakMs();
    this.breakMeta = meta;
    this.onEvent({ type: 'break-start', breakEndAt: this.state.breakEndAt, breakSec: this.config.breakMin * 60, meta });
  }

  completeBreak(now, reason = 'countdown') {
    const planned = this.state.breakEndAt;
    this.stats.today.breaksDone += 1;
    this.stats.today.lastBreakAt = now;
    this.state.lastBreakAt = now;
    this.onEvent({ type: 'break-complete', reason, earlySec: Math.max(0, Math.round((planned - now) / 1000)) });
    this.beginCycle(now);
  }

  /** 稍后 N 分钟再来 */
  snooze(now) {
    if (this.state.phase === PHASE.BREAK) {
      this.stats.today.snoozes += 1;
      const delay = this.config.snoozeMin * 60000;
      this.onEvent({ type: 'break-snooze', minutes: this.config.snoozeMin });
      this.state.phase = PHASE.FOCUS;
      this.state.cycleStartAt = now;
      this.state.nextDueAt = now + delay;
      this.state.breakStartAt = 0;
      this.state.breakEndAt = 0;
      this.freeze = { reason: FREEZE.NONE, at: 0 };
      return;
    }
    this.state.nextDueAt = now + this.config.snoozeMin * 60000;
  }

  skip(now) {
    if (this.state.phase !== PHASE.BREAK) return;
    this.stats.today.breaksSkipped += 1;
    this.onEvent({ type: 'break-skipped' });
    this.beginCycle(now);
  }

  finishNow(now) {
    if (this.state.phase !== PHASE.BREAK) return;
    this.completeBreak(now, 'manual');
  }

  /** 手动暂停：不再累计久坐，也不弹提醒 */
  pause(now, reason = FREEZE.MANUAL) {
    if (this.state.phase === PHASE.BREAK) this.completeBreak(now, 'pause-during-break');
    if (this.state.phase === PHASE.PAUSED) return;
    this.state.phase = PHASE.PAUSED;
    this.freeze = { reason, at: now };
    this.onEvent({ type: 'paused', reason });
  }

  resume(now) {
    if (this.state.phase !== PHASE.PAUSED) return;
    const wasManual = this.freeze.reason === FREEZE.MANUAL;
    if (wasManual) {
      const remaining = Math.max(0, this.state.nextDueAt - this.freeze.at);
      this.state.nextDueAt = now + (remaining || this.intervalMs());
      this.state.cycleStartAt = now - (this.intervalMs() - (remaining || this.intervalMs()));
      this.state.phase = PHASE.FOCUS;
      this.freeze = { reason: FREEZE.NONE, at: 0 };
      this.lastPrewarnAt = 0;
      this.onEvent({ type: 'resumed', reason: FREEZE.MANUAL });
    }
  }

  freezeForIdle(now, idleSec) {
    if (this.state.phase !== PHASE.FOCUS) return;
    this.state.phase = PHASE.IDLE;
    this.freeze = { reason: FREEZE.IDLE, at: now };
    this.onEvent({ type: 'frozen', reason: FREEZE.IDLE, idleSec });
  }

  freezeForLock(now) {
    if (this.state.phase === PHASE.BREAK) this.completeBreak(now, 'locked-away');
    if (this.state.phase === PHASE.PAUSED) return;
    this.state.phase = PHASE.IDLE;
    this.freeze = { reason: FREEZE.LOCK, at: now };
    this.onEvent({ type: 'frozen', reason: FREEZE.LOCK });
  }

  unfreeze(now, { postponeFullCycle = false } = {}) {
    if (this.state.phase !== PHASE.IDLE) return;
    const awayMs = Math.max(0, now - this.freeze.at);
    const reason = this.freeze.reason;
    this.freeze = { reason: FREEZE.NONE, at: 0 };
    const full = reason === FREEZE.LOCK ? this.config.lockPostpone || postponeFullCycle : false;
    if (full) {
      this.beginCycle(now);
    } else {
      this.state.nextDueAt += awayMs;
      this.state.cycleStartAt += awayMs;
      this.state.phase = PHASE.FOCUS;
    }
    this.lastPrewarnAt = 0;
    this.onEvent({ type: 'unfrozen', reason, awaySec: Math.round(awayMs / 1000) });
  }

  /** 用户点了“现在就开始休息” */
  triggerBreakNow(now) {
    if (this.state.phase === PHASE.BREAK) return;
    this.freeze = { reason: FREEZE.NONE, at: 0 };
    this.state.phase = PHASE.FOCUS;
    this.state.nextDueAt = now;
    this.startBreak(now);
  }

  resetCycle(now) {
    this.beginCycle(now);
    this.onEvent({ type: 'cycle-reset' });
  }

  /**
   * @param {number} now      当前毫秒时间戳
   * @param {number} idleSec  powerMonitor.getSystemIdleTime()，距上次键鼠输入的秒数
   * @param {object} opts     overlayShowing：全屏遮罩正在屏幕上倒计时
   */
  tick(now, idleSec = 0, { overlayShowing = false } = {}) {
    this.lastRealNow = now;
    const rawGap = now - this.lastTickAt;
    const dt = Math.min(this.maxTickDeltaMs, Math.max(0, rawGap));
    this.lastTickAt = now;
    this.rollDayIfNeeded(now);

    const threshold = this.idleThresholdSec;
    const away = this.config.idlePause && idleSec >= threshold;

    switch (this.state.phase) {
      case PHASE.BREAK: {
        /**
         * 「休息期间闲置 = 已经起身」这条捷径有两道闸：
         * 1) 遮罩正盖在屏幕上时不生效——遮罩本身就是倒计时，人不动手是设计如此，
         *    否则设 1 分钟休息也会在 25 秒时被判定完成；
         * 2) 休息时长不足 BREAK_AWAY_MIN_MS 时也不生效，短休息就该老老实实走完。
         */
        const longEnough = now - this.state.breakStartAt >= BREAK_AWAY_MIN_MS;
        if (!overlayShowing && longEnough && idleSec >= 25 && this.config.idlePause) {
          this.completeBreak(now, 'away');
        } else if (now >= this.state.breakEndAt) {
          this.completeBreak(now, 'countdown');
        }
        break;
      }
      case PHASE.FOCUS: {
        if (away) {
          this.freezeForIdle(now, idleSec);
          break;
        }
        this.stats.today.focusSec += dt / 1000;
        const hour = new Date(now).getHours();
        this.stats.today.hourly[hour] = (this.stats.today.hourly[hour] || 0) + dt / 3600000;
        if (dt / 1000 > 0) {
          this.stats.today.longestFocusSec = Math.max(
            this.stats.today.longestFocusSec,
            Math.round((now - this.state.cycleStartAt) / 1000)
          );
        }
        const lead = this.config.prewarnSec * 1000;
        if (lead > 0 && now + lead >= this.state.nextDueAt && this.lastPrewarnAt === 0) {
          this.lastPrewarnAt = now;
          this.onEvent({ type: 'prewarn', remainingSec: Math.round((this.state.nextDueAt - now) / 1000) });
        }
        if (now >= this.state.nextDueAt) {
          // 进程被挂起/睡眠导致长时间没 tick：不补罚，顺延一个完整周期
          if (rawGap > this.sleepGapMs) this.beginCycle(now);
          else this.startBreak(now);
        }
        break;
      }
      case PHASE.IDLE: {
        // 锁屏冻结后只要有 1 分钟输入就算回来了；普通闲置冻结要回到阈值以内
        const resumeBelow = this.freeze.reason === FREEZE.LOCK ? Math.min(60, threshold) : threshold;
        if (idleSec < resumeBelow) this.unfreeze(now);
        break;
      }
      case PHASE.PAUSED:
      default:
        break;
    }

    return this.snapshot(now, idleSec);
  }

  snapshot(now = this.lastRealNow || Date.now(), idleSec = 0) {
    const focusTotal = this.intervalMs();
    /** 冻结/暂停期间「现在」停在离开那一刻，界面不会自己往下走 */
    const held = this.state.phase === PHASE.IDLE || this.state.phase === PHASE.PAUSED;
    const shownNow = held && this.freeze.at ? Math.min(now, this.freeze.at) : now;
    const focusRemaining = Math.max(0, this.state.nextDueAt - shownNow);
    const breakRemaining = Math.max(0, this.state.breakEndAt - now);
    return {
      phase: this.state.phase,
      freezeReason: this.freeze.reason,
      paused: this.state.phase === PHASE.PAUSED,
      awaySec: this.freeze.at && this.state.phase === PHASE.IDLE ? Math.round((now - this.freeze.at) / 1000) : 0,
      idleSec: Math.round(idleSec),
      nextDueAt: this.state.nextDueAt,
      lastBreakAt: this.state.lastBreakAt || 0,
      focusRemainingSec: Math.round(focusRemaining / 1000),
      focusTotalSec: Math.round(focusTotal / 1000),
      focusElapsedSec: Math.round(Math.max(0, Math.min(focusTotal, focusTotal - focusRemaining)) / 1000),
      breakRemainingSec: Math.round(breakRemaining / 1000),
      breakTotalSec: this.config.breakMin * 60,
      config: { ...this.config },
      stats: this.statsView(),
    };
  }

  statsView() {
    const t = this.stats.today;
    const series = [];
    const keys = Object.keys(this.stats.history).sort().slice(-6);
    for (const k of keys) series.push({ day: k, focusMin: Math.round((this.stats.history[k].focusSec || 0) / 60) });
    series.push({ day: this.stats.todayKey, focusMin: Math.round(t.focusSec / 60), partial: true });
    return {
      date: this.stats.todayKey,
      sittingMin: Math.round(t.focusSec / 60),
      breaksDone: t.breaksDone,
      breaksSkipped: t.breaksSkipped,
      snoozes: t.snoozes,
      longestFocusMin: Math.round(t.longestFocusSec / 60),
      lastBreakAt: this.state.lastBreakAt || 0,
      hourly: t.hourly.map((v) => Math.round(v * 60)),
      week: series,
    };
  }

  serialize() {
    return {
      version: 1,
      config: this.config,
      state: this.state,
      freeze: this.freeze,
      stats: this.stats,
      savedAt: Date.now(),
    };
  }
}

module.exports = { Engine, PHASE, FREEZE, DEFAULT_CONFIG, CONFIG_LIMITS, dayKey, emptyDay };

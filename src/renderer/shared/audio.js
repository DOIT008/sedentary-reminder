/* 提示音：纯 WebAudio 合成，不依赖音频文件。默认音量克制，避免在会议室里社死。 */
(function () {
  'use strict';

  let ctx = null;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC({ latencyHint: 'interactive' });
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function bus(ac, level) {
    const master = ac.createGain();
    master.gain.value = level;
    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    tone.Q.value = 0.6;
    master.connect(tone).connect(ac.destination);

    // 一点点延迟反馈当空间感，比干信号柔和
    const delay = ac.createDelay(0.4);
    delay.delayTime.value = 0.135;
    const feedback = ac.createGain();
    feedback.gain.value = 0.26;
    const wet = ac.createGain();
    wet.gain.value = 0.3;
    tone.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(ac.destination);
    return master;
  }

  function note(ac, dest, { freq, at, dur, peak = 0.5, type = 'sine', glide = 0 }) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(freq * glide, at + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  const SCORES = {
    // 该起身了：上行两声 + 一层低八度垫音
    alert: { level: 0.5, notes: [[659.25, 0, 1.5, 0.5], [880, 0.16, 1.9, 0.42], [329.63, 0, 2.2, 0.16, 'triangle']] },
    // 休息结束：下行三声，收束感
    done: { level: 0.42, notes: [[783.99, 0, 0.9, 0.34], [587.33, 0.12, 1.1, 0.3], [440, 0.24, 1.6, 0.26]] },
    // 快到了：一声很轻的点
    warn: { level: 0.24, notes: [[987.77, 0, 0.42, 0.24]] },
    // 交互试听用
    preview: { level: 0.5, notes: [[523.25, 0, 1.2, 0.4], [659.25, 0.14, 1.5, 0.34], [987.77, 0.28, 1.8, 0.2]] },
  };

  function play(kind) {
    const score = SCORES[kind] || SCORES.alert;
    const ac = audio();
    if (!ac) return false;
    const dest = bus(ac, score.level);
    const t0 = ac.currentTime + 0.02;
    for (const [freq, offset, dur, peak, type] of score.notes) {
      note(ac, dest, { freq, at: t0 + offset, dur, peak, type: type || 'sine' });
    }
    return true;
  }

  window.SAudio = { play, unlock: audio };
})();

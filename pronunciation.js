(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrePronunciation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // These headwords change stress with meaning; use the PDF's part of speech.
  const senseRecordings = {
    "1-1": { word: "minute", path: "m/min/minut/minute_02_00.mp3", ipa: "maɪˈnuːt" },
    "1-27": { word: "entrance", path: "e/eus/eus71/eus71583.mp3", ipa: "ɪnˈtræns" },
    "2-13": { word: "contract", path: "c/con/contr/contract_02_00.mp3", ipa: "kənˈtrækt" }
  };

  function dictionaryTrack(value) {
    const word = typeof value === "string" ? { word: value } : value;
    // Cambridge has headword recordings, not a continuous recording of this phrase.
    if (word.word.trim().toLowerCase() === "hew to") return {
      url: "https://dictionary.cambridge.org/us/media/english/us_pron/h/hew/hew__/hew.mp3",
      following: ["https://dictionary.cambridge.org/us/media/english/us_pron/t/to_/to___/to.mp3"],
      label: "剑桥 · 美式分词录音（hew + to）", ipa: "hjuː tuː",
      reference: "https://dictionary.cambridge.org/us/pronunciation/english/hew"
    };
    const sense = senseRecordings[word.id];
    if (sense && sense.word === word.word) return {
      url: `https://dictionary.cambridge.org/us/media/english/us_pron/${sense.path}`,
      label: "剑桥 · 美式词典录音", ipa: sense.ipa,
      reference: `https://dictionary.cambridge.org/us/pronunciation/english/${encodeURIComponent(word.word)}`
    };
    return { url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word.word)}&type=2`,
      label: "有道 · 美式词典音频", ipa: "",
      reference: `https://www.youdao.com/result?word=${encodeURIComponent(word.word)}&lang=en` };
  }

  function americanVoices(voices) {
    const preferred = (voice) => /\b(Samantha|Alex|Ava|Allison|Susan|Tom|Zoe|Google US English|Microsoft.*(Aria|Jenny|Guy))\b/i.test(voice.name);
    return voices.filter((voice) => String(voice.lang).replace(/_/g, "-").toLowerCase() === "en-us")
      .sort((a, b) => Number(b.localService) - Number(a.localService) || Number(preferred(b)) - Number(preferred(a)) || Number(b.default) - Number(a.default) || a.name.localeCompare(b.name));
  }

  function create(host, onStatus = () => {}) {
    const synth = host.speechSynthesis;
    const supported = !!synth && typeof host.SpeechSynthesisUtterance === "function";
    const supportsAudio = typeof host.Audio === "function";
    let source = "system";
    let audio = null;
    let audioTimer = null;
    let track = null;
    let muted = false;
    let voiceURI = "";
    let token = 0;
    let pendingText = "";
    let active = null;
    let playing = false;
    let message = "";
    let lastError = "";

    function voices() {
      if (!supported) return [];
      try { return americanVoices(synth.getVoices()); }
      catch (error) { return []; }
    }
    function emit() {
      const list = voices();
      const voice = list.find((item) => item.voiceURI === voiceURI) || list[0];
      onStatus({ supported: source === "dictionary" ? supportsAudio : supported, source, track, muted, playing, message, lastError, voices: list, voice: voice || null });
    }
    function stop() {
      token++;
      pendingText = "";
      active = null;
      playing = false;
      message = "";
      lastError = "";
      if (audioTimer) host.clearTimeout(audioTimer);
      audioTimer = null;
      if (audio) {
        audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null;
      }
      if (supported) synth.cancel();
      emit();
    }
    function speakSystem(text) {
      stop();
      if (muted || !supported || !text) return false;
      const list = voices();
      const voice = list.find((item) => item.voiceURI === voiceURI) || list[0];
      if (!voice) {
        pendingText = text;
        message = "未找到美式语音，请在系统中添加英语（美国）语音。";
        emit();
        return false;
      }
      const generation = token;
      const utterance = new host.SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.voice = voice;
      utterance.rate = 0.9;
      lastError = "";
      active = utterance;
      utterance.onstart = () => {
        if (generation !== token) return;
        playing = true; message = "正在发音"; emit();
      };
      utterance.onend = () => {
        if (generation !== token) return;
        playing = false; active = null; message = ""; emit();
      };
      utterance.onerror = (event) => {
        if (generation !== token || ["canceled", "interrupted"].includes(event.error)) return;
        playing = false; active = null; lastError = event.error || "failed";
        message = event.error === "not-allowed" ? "点击播放按钮开启发音" : "发音暂不可用，请点击播放按钮重试。";
        emit();
      };
      emit();
      try { synth.speak(utterance); return true; }
      catch (error) {
        active = null; lastError = "failed"; message = "发音暂不可用，请点击播放按钮重试。"; emit(); return false;
      }
    }
    function speak(value) {
      const text = typeof value === "string" ? value : value.word;
      if (source === "system") return speakSystem(text);
      stop();
      if (muted || !supportsAudio || !text) return false;
      track = dictionaryTrack(value);
      const generation = token;
      const urls = [track.url, ...(track.following || [])];
      let part = 0;
      const player = new host.Audio(urls[part]);
      audio = player;
      player.preload = "auto";
      message = "加载词典音频…";
      emit();
      function clearTimer() { if (audioTimer) host.clearTimeout(audioTimer); audioTimer = null; }
      function fail(error) {
        if (generation !== token || error?.name === "AbortError") return;
        clearTimer(); playing = false;
        lastError = error?.name || "media-error";
        message = lastError === "NotAllowedError" ? "点击播放按钮开启发音" : "词典音频暂不可用，请重播或更换发音来源。";
        player.pause(); emit();
      }
      player.onplaying = () => { if (generation !== token) return; clearTimer(); playing = true; message = "正在播放"; emit(); };
      player.onended = () => {
        if (generation !== token || lastError) return;
        clearTimer();
        if (++part < urls.length) {
          // Reuse the unlocked element for the next recording on iPhone.
          player.src = urls[part];
          playing = false; message = "加载词典音频…"; emit();
          audioTimer = host.setTimeout(() => fail({ name: "TimeoutError" }), 10000);
          try { Promise.resolve(player.play()).catch(fail); } catch (error) { fail(error); }
        } else { playing = false; message = ""; emit(); }
      };
      player.onerror = () => fail({ name: "media-error" });
      audioTimer = host.setTimeout(() => fail({ name: "TimeoutError" }), 10000);
      try { Promise.resolve(player.play()).catch(fail); return true; }
      catch (error) { fail(error); return false; }
    }
    function setSource(value) { stop(); source = value === "system" ? "system" : "dictionary"; track = null; emit(); }
    function setMuted(value) { muted = !!value; if (muted) stop(); else emit(); }
    function setVoice(value) { voiceURI = value || ""; emit(); }
    function voicesChanged() {
      const text = pendingText;
      emit();
      if (text && !muted && voices().length) speak(text);
    }
    if (supported) synth.addEventListener?.("voiceschanged", voicesChanged);
    return { speak, stop, voices, setMuted, setVoice, setSource, refresh: emit,
      dispose() { stop(); if (supported) synth.removeEventListener?.("voiceschanged", voicesChanged); } };
  }
  return { americanVoices, dictionaryTrack, create };
});

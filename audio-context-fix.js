(function configureIOSAudioContext() {
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var NativeAudioContext = window.AudioContext || window.webkitAudioContext;

  if (!isIOS || !NativeAudioContext) return;

  function ModelAudioContext(options) {
    var requestedOptions = Object.assign({}, options || {}, {
      latencyHint: "interactive",
      sampleRate: 44100
    });

    try {
      return new NativeAudioContext(requestedOptions);
    } catch (error) {
      return new NativeAudioContext(options);
    }
  }

  ModelAudioContext.prototype = NativeAudioContext.prototype;
  try {
    Object.setPrototypeOf(ModelAudioContext, NativeAudioContext);
  } catch (error) {}

  try {
    window.AudioContext = ModelAudioContext;
  } catch (error) {}
  try {
    window.webkitAudioContext = ModelAudioContext;
  } catch (error) {}
})();

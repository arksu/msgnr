
Current `Setting` dialog rename to `Profile`.

add new `Settings` dialog:

+--------------------------------------------------------------+
| Settings                                                     |
+--------------------------------------------------------------+
| Input Device         [ System Default Microphone       v ]   |
|                      Status: Ready                           |
|                      [ Test Microphone ]                     |
|                      Input Level: [||||||||......]  62%      |
|                                                              |
| Output Device        [ AirPods Pro                    v ]    |
|                      Status: Connected                       |
|                      [ Play Test Sound ]                     |
|                                                              |
| > Advanced audio settings                                    |
|                                                              |
| [ Cancel ]                                      [ Save ]     |
+--------------------------------------------------------------+

implement:
  Audio input device selection
  Audio output device selection
  Input/output device testing
  Permissions and device state feedback
  Basic audio tuning controls
  Error and fallback handling


The goal is to make the experience:
  predictable
  low-friction
  diagnosable when devices fail
  extensible for future voice features


Scope
In scope
  Add audio section to existing settings dialog
  Enumerate available microphones and speakers
  Allow user to select preferred input and output devices
  Allow testing microphone and speaker
  Show permission state and device health
  Persist preferences
  Handle unplugged/missing devices gracefully
  Provide accessible keyboard and screen-reader support
Out of scope
  Full DAW-style audio processing
  Advanced EQ/noise suppression tuning unless already supported by platform
  Per-device firmware management
  OS-level device permission prompts beyond invoking native browser/app flow

Use plain, operational wording.
Labels
  Input Device
  Output Device
  Test Microphone
  Play Test Sound
  Microphone Level
  Advanced Audio Settings
Helper text
  “Choose which microphone the agent uses for voice input.”
  “Choose where audio responses are played.”
  “System default follows your operating system’s current device.”
Status text examples
  “Microphone access granted.”
  “No input detected.”
  “Selected device disconnected. Using system default.”
  “Output device switching is not supported on this platform.”

Edge Cases
  Device list empty on first open
  User denies microphone permission, then reopens settings later
  Bluetooth headset connects after dialog already opened
  Saved device label changes after OS update
  Browser returns device IDs only after permission grant
  Output selection unavailable in some browsers/platforms
  Active test continues while device disconnects
  User changes OS default while app is open

Acceptance Criteria:
Functional
  User can select input device
  User can select output device where supported
  User can test both
  Preferences persist
  Missing devices fall back safely
  Audio section updates on device changes
UX
  User can understand current active device within 3 seconds of opening Audio settings
  Error states are explicit and actionable
  No hidden silent failures during test
Accessibility
  Entire flow operable via keyboard
  Screen readers announce labels, states, and errors

+---------------------------------------------------------------+
| v Advanced audio settings                                     |
| ------------------------------------------------------------- |
| Noise Suppression        [ On  ]                              |
| Echo Cancellation        [ On  ]                              |
| Auto Gain Control        [ Off ]                              |
| Fallback to System Default [x]                                |
| Show unavailable devices    [ ]                               |
+---------------------------------------------------------------+


implement Advanced audio settings:
Noise Suppression
Echo Cancellation
Auto Gain Control
---------------
Technical Task: Integrate RNNoise Noise Suppression into Web Voice Pipeline

Add one more option to "Advanced audio settings" : "Noise suppression" (rnnoise-wasm) (checkbox)

Objective
Implement real-time microphone noise suppression using RNNoise in the browser before sending audio to LiveKit.
The solution must run entirely on the frontend and process microphone audio using WebAudio + AudioWorklet + RNNoise (WASM).

Create a **WebAudio processing pipeline**:

```
Microphone
↓
MediaStreamAudioSourceNode
↓
AudioWorkletNode
↓
RNNoise (WASM)
↓
MediaStreamDestination
↓
LiveKit publishTrack()
```

4. Use **RNNoise compiled to WebAssembly** for real-time noise filtering.

5. Audio processing must run inside **AudioWorkletProcessor** to avoid main thread blocking.

6. The AudioWorklet must:

* buffer audio frames
* convert to RNNoise frame size (480 samples / 10 ms)
* run RNNoise processing
* output cleaned audio frames.

7. Output processed audio as a **MediaStreamTrack**.

8. Publish the processed track to LiveKit instead of the raw microphone track.

---

# Non-Functional Requirements

* Latency added by processing must be **< 20 ms**.
* CPU usage must remain minimal.
* No server-side audio processing.
* Compatible with modern browsers:

  * Chrome
  * Edge
  * Firefox
  * Safari (best effort)


use flow:
Microphone
↓
WebRTC constraints (AEC + AGC)
↓
WebAudio AudioWorklet
↓
RNNoise (WASM)
↓
MediaStreamTrack
↓
LiveKit publishTrack()

browser Web Audio API:
getUserMedia
↓
MediaStreamAudioSourceNode
↓
AudioWorkletNode
↓
RNNoise (WASM)
↓
MediaStreamDestination
↓
LiveKit track

---
# Implementation Components

### 1. RNNoise WASM

* Compile RNNoise to WebAssembly using Emscripten.
* Load the WASM module inside the AudioWorklet.

---

### 2. AudioWorklet Processor

File:

```
rnnoise-worklet.js
```

Responsibilities:

* receive audio input
* buffer samples
* call RNNoise processing
* output filtered audio.

# Performance Considerations

* RNNoise processing must run in AudioWorklet thread.
* Lazy-load RNNoise module only when microphone is activated.
* Ensure correct frame buffering (RNNoise expects **480 samples**).

---

# Acceptance Criteria

The implementation is complete when:

1. Microphone audio passes through RNNoise before publishing.
2. Background noise (keyboard, fan, ambient noise) is reduced.
3. LiveKit receives the processed audio track.
4. Feature can be toggled in UI.
5. No noticeable latency is introduced.


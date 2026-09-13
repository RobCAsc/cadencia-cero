# CLAUDE.md — Cadencia Cero

A stationary-bike training game. Zombies chase the player on screen; the player pedals to stay ahead. Pedaling cadence comes from a real BLE sensor on a dumb spin bike.

This file is the contract for the project. Read it before proposing architecture. Several decisions below were made deliberately after evaluating alternatives — the rationale is included so they don't get re-litigated or silently reversed.

## Hardware reality

The bike is a Centurfit belt-and-felt-pad spin bike, 6 kg flywheel, with a basic LCD monitor. This matters more than it sounds, because it rules out most of what fitness apps normally assume:

- **No power meter.** Watts cannot be measured, only estimated.
- **No electronic resistance.** The resistance knob is analog and unmarked. There is no ERG mode. The app can *ask* the rider to change resistance; it can never *set* it.
- **No native connectivity.** The stock LCD is fed by a passive reed switch. It has no Bluetooth and no ANT+.

Input therefore comes from an aftermarket **BLE cadence sensor** strapped to the crank arm, speaking the standard Cycling Speed and Cadence profile. An optional **BLE heart rate strap** is the second input. A future phase may replace the commercial sensor with an ESP32 tapping the bike's reed switch, but that is explicitly out of scope until Phase 3.

## Platform and stack

Target is an **Android tablet**, so the app is a **PWA**: Vite + TypeScript + Phaser 3, deployed as a static site.

This was chosen over Flutter and Unity for a reason worth preserving: Web Bluetooth is fully supported in Chrome on Android, iteration happens with hot reload against the real device over the network, and there is no store submission in the loop. The tradeoff accepted is that **this will never run on iOS Safari**. That is fine and is not a bug to fix.

Constraints that follow from Web Bluetooth and will cause confusing failures if forgotten:

- **HTTPS is mandatory.** `localhost` works for desktop development, but testing from the tablet requires a real HTTPS host or a tunnel. Opening a `file://` URL will silently fail to connect.
- **`requestDevice()` requires a user gesture.** There will always be a "Connect" button and a native chooser. Design the start screen around this rather than trying to auto-reconnect on load.
- **Request a screen wake lock** (`navigator.wakeLock.request('screen')`) when a session starts, and re-acquire it on `visibilitychange`. Without it the tablet sleeps mid-workout.
- **Backgrounded tabs stop receiving BLE notifications.** Sessions assume foreground, fullscreen, and mains power.

## The core loop

The entire game is one integral:

```
gap += (playerSpeed - zombieSpeed) * dt
```

`gap` is the distance in metres between the rider and the pursuing horde. `zombieSpeed` is read from the active training program. `playerSpeed` is derived from heart-rate effort (pulse mode, the default since 2026-09-13) or from cadence and the declared resistance level (cadence mode).

Everything else — art, sound, terrain, HUD — is decoration on this. If the loop isn't tense with placeholder rectangles, it won't be tense with sprites.

### Deriving player speed

For v1, **do not implement a physics model.** Use a hand-tuned lookup table mapping `(resistanceLevel, cadence) → km/h`, interpolated linearly. A friction brake produces roughly constant torque for a given knob position, so `power ≈ torque(level) × cadence` is defensible physics, but torque cannot be measured on this bike, which makes the model's precision imaginary. The lookup table is equally accurate and can be retuned in two minutes. Revisit only when the game demonstrably feels wrong.

Resistance level is **declared by the rider**, not sensed: a coarse 1–8 control on the HUD, adjustable mid-ride without stopping.

### Getting caught

Being caught **must not end the session.** It costs health, costs distance, and should be loud and unpleasant — but a game-over screen terminates the workout at precisely the moment the training stimulus is highest. Design the failure state as a setback within the ride, never as a terminal condition.

## BLE implementation notes

These are the parts that are easy to get subtly wrong. They were worked out already; implement them this way.

**Cycling Speed and Cadence** — service `0x1816`, characteristic `0x2A5B` via notifications. Byte 0 is flags. Bit 0 set means wheel revolution data is present (6 bytes, skip it). Bit 1 set means crank data is present; if it isn't, discard the packet. Crank data is a uint16 LE cumulative revolution count followed by a uint16 LE event timestamp in 1/1024-second units.

Two failure modes to handle explicitly:

1. **16-bit rollover.** Both counters wrap at 65536, which does happen in long sessions. Compute deltas as `(current - previous + 65536) % 65536`.
2. **Stale cadence when the rider stops.** The sensor stops notifying when the cranks stop, so the last cadence value freezes and the zombie never catches anyone. The game loop — not the BLE callback — must zero cadence if no packet has arrived in ~3 seconds. This is the single most important correctness detail in the input layer.

**Heart rate** — service `0x180D`, characteristic `0x2A37`. Bit 0 of the flags byte selects uint8 (byte 1) versus uint16 LE payload for the BPM value.

Structure the input layer behind an interface with two implementations — a real BLE source and a fake one driven by an on-screen slider — selectable at runtime. The fake source is not throwaway scaffolding; it is how the game gets developed and debugged at a desk without pedaling.

## Training programs

A program is the zombie's speed profile over time. This is the central design idea: **the workout prescription and the antagonist's behaviour are the same object.** A recovery ride is a slow, distant, steady pursuer. An interval session is a horde that surges every ninety seconds. A threshold session is one runner sustaining pressure for twenty minutes.

Programs are JSON, loaded from static files, roughly:

```json
{
  "id": "hiit-30-30",
  "name": "Oleadas",
  "target": "anaerobic",
  "segments": [
    { "kind": "warmup", "durationSec": 300, "zombieSpeedKph": 14, "cueResistance": 2 },
    { "kind": "surge", "durationSec": 30, "zombieSpeedKph": 32 },
    { "kind": "recover", "durationSec": 90, "zombieSpeedKph": 12 },
    { "kind": "repeat", "times": 8, "fromIndex": 1 }
  ]
}
```

When a heart rate strap is connected, a segment may instead specify a target HR zone, and zombie speed becomes closed-loop: it accelerates while the rider is below zone and eases off above it. This auto-calibrates across fitness levels and resistance-knob positions, which is the honest answer to "support different training purposes and speeds" on a bike that cannot report effort.

## Habit and progress

The health goal is the habit, so the game measures the habit and nothing else. Everything is derived from the list of stored sessions (`src/sim/progress.ts`, pure and unit tested, fed by `src/storage/sessionStore.ts`):

- **Weekly goal with two doors**: 3 rides a week *or* 150 minutes in zone 2 or above (the WHO moderate-activity guideline). Crossing either door completes the week. A ride counts once it lasts five minutes; a ride cut short is saved, never discarded.
- **The streak counts weeks, not days**, and forgives one missed week between two completed ones. A daily streak punishes the beginner and breaks the habit it pretends to build.
- **The Route**: every kilometre of every ride adds up to a single journey with named refuges as milestones. They are markers on the road, not a story.
- **Personal records and health**: first ride without being caught, longest ride, best cardio minutes, and the resting heart-rate trend, which is the most honest indicator of improvement this hardware can give.
- **Today's ride**: a recommendation by level and by what the week already holds. Beginners get short, slow rides ("Primera salida") before the rotation base → surges → recovery kicks in; two hard days are never chained.

Deliberately excluded (decided 2026-09-13): cosmetic unlockables, XP, levels. The reward is the sunrise at the end of the ride and the numbers moving.

## Phasing

**Phase 0 — playable, no hardware.** Done. Full game loop, slider-driven cadence, placeholder art, one hardcoded program. The fun gate passed on 2026-08-29.

**Phase 1 — real input.** Re-scoped on 2026-09-13: the rider decided not to buy a cadence sensor. The real input is **heart rate**, from a Huawei Band 9 broadcasting the standard Heart Rate profile, and the effort fraction (Karvonen, heart-rate reserve) drives player speed through a hand-tuned effort → km/h table. BLE CSC cadence stays implemented behind the same input interface as a future option; the fake cadence source stays too. Still open: tuning the effort table against real rides.

**Phase 2 — training system.** Done. Program catalogue with light adjustments, heart-rate integration, rider profile with rest and comfortable-pace tests plus self-correcting calibration, session history in IndexedDB, post-session summary, and the habit layer above. Deferred on purpose: closed-loop zombie speed (the effort table already closes the loop through the rider's pulse) and loading programs by fetch (the TypeScript catalogue has the same shape as the JSON).

**Phase 3 — optional.** ESP32 reading the bike's own reed switch and re-broadcasting as standard CSC, removing the dependency on the purchased sensor. Firmware, not app work.

## Anti-goals

Do not build 3D. A 2.5D parallax side-scroller delivers the sensation at a fraction of the cost.

Do not build a backend, accounts, or cloud sync in v1. Session history goes in IndexedDB. This is a single-user app for one tablet.

Do not add procedural terrain, story, cosmetic unlockables, or multiplayer. They are all more appealing to build than the calibration work, which is exactly why they need to be held back. Habit metrics (weekly goal, streak, the Route, records) are not unlockables: they are the point, and they shipped with Phase 2.

Do not model physics until the lookup table demonstrably fails.

## Working agreements

Propose a plan before writing code for anything spanning more than one file. Keep the BLE layer, the simulation, and the rendering separate enough that the simulation can be unit tested with no browser and no Phaser. Prefer small commits with running code at each step over large correct-in-theory refactors.

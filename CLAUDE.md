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

Since 2026-09-13 a segment prescribes a **heart-rate zone** (a single zone or an inclusive range; 0 is "easy", below Z1), and the horde's speed is derived from it. Programs are TypeScript objects with the shape of this JSON:

```json
{
  "id": "oleadas",
  "name": "Oleadas",
  "target": "anaerobic",
  "segments": [
    { "kind": "warmup", "durationSec": 300, "zone": [0, 2], "cueResistance": 2 },
    { "kind": "surge", "durationSec": 60, "zone": [4, 5] },
    { "kind": "recover", "durationSec": 120, "zone": [1, 2] },
    { "kind": "repeat", "times": 6, "fromIndex": 1 }
  ]
}
```

A segment may also carry a text `cue` shown when it starts, in any input mode ("Cuesta: sube resistencia, cadencia baja"); that is how "Cuestas" asks for strength work the bike cannot measure. A `grade` in percent is presentation only: the road and the bushes tilt around the rider's feet (`slopeForGrade`, exaggerated ×1.6 so a 6 % climb reads on screen), the horde comes from lower down, and the HUD says "Cuesta ▲ 6 %"; it flattens again on the recovery. Not procedural terrain: the prescription made visible. The kind `push` is the optional one-minute Z3 effort the rider can accept mid-Fondo; it never appears in the catalogue, the simulation inserts it.

The zone has a **floor and a ceiling**. The horde runs at the speed of an effort a third of the way *into* the zone (`ZONES.hordeFraction`, via the effort table): sitting on the bottom edge of the zone loses ground slowly, the middle holds, and dropping below the zone means being caught. Above the ceiling the gap stops growing: recovering properly is part of the prescription, and overdoing an easy segment must not pay. The horde at the floor was tried first and the game went inert: any pedalling above the floor pinned the gap at the cap for the whole ride (real ride, 2026-09-14). `zombieSpeedKph` may still be given explicitly (tests do), but the catalogue never does. Closed-loop horde speed (the horde adapting to the rider's zone) was considered and deferred: the effort table already closes the loop through the rider's pulse, and the floor/ceiling rule does the rest.

## Pulse-only design

The only sensor is a wrist heart-rate band, and a wrist optical sensor lags effort by 10 to 30 seconds. Everything below follows from that, and `src/sim/programs/catalog.pulse.test.ts` guards it: a model rider with a lagged pulse (τ 20 s up, 35 s down) who follows the prescribed zone is never caught by any catalogue program, and a rider who sits in Z2 through the surges is. If a tunable changes, that test says whether the game still enforces the workout.

- **Hard efforts last 60 seconds or more.** A 30-second sprint cannot be judged by a sensor that reacts in 20. The horde accelerates over a 12-second ramp (`zombieRampUpSec`) and the warning comes 15 seconds early (`surgeWarningSec`): the rider pushes before the horde arrives, and the horde arrives at the pace the heart does.
- **The gap cap is 100 m** (`gapMaxM`) and **the ride starts at 50 m** (`initialGapM`), so the advantage is earned and the number moves from the first minute. With 150 m, skipping every surge and recovering "well" refilled the buffer each cycle and nobody was ever caught; starting at the cap made a good ride look static. The horde **wakes up** over the first 45 seconds (`hordeWakeSec`, standing still at 0 s), which covers the minute the pulse needs to rise from rest.
- **Calibration is an eight-minute "escalera" plus what the rides say**, not a subjective single anchor. Resting pulse comes from the pre-ride ritual (median of the last readings, unless set by hand). Maximum comes from two talk-test anchors, two minutes each after four of warm-up: "you can talk in full sentences" (≈ 65 % of heart-rate reserve) and "you cannot talk" (≈ 85 %), weighted toward the hard one and clamped to the age estimate ± 15 bpm. The escalera is offered from the sixth ride (its hard step is not for day one) and asked for again after six weeks or when the resting pulse drops 5 bpm. A sustained peak observed in a ride raises the maximum **by at most 3 bpm per ride, and only if the ride was clean and the rider did not call it "demasiado"**: a day of overdoing it must never make the next ride harder. Zones are 10 % of the heart-rate reserve each, so the profile refuses a reserve under 60 bpm (`MIN_RESERVE_BPM`) and warns under 80 (`reserveWarning`): with rest 69 and a "test" maximum of 120 each zone measured five beats and the ride became chasing a number (real, 2026-09-15); "Por edad" in the profile restores the age estimate in one tap, and the dev panel's fake pulse (`?dev=1`) is the tool for testing without pedalling. After every ride the rider answers fácil / justa / demasiado. Being caught twice in easy segments, or "demasiado" having held the zone, lowers the demand; raising it requires "fácil" plus no catches and either low average effort or more than half the ride above the ceiling.
- **The plan has phases** (`recommendToday`): arranque (rides 1 to 5: short, Z1 to Z2, no surges), base (6 to 11: longer base rides and the first "Empujones", three times two minutes in Z3), rotación (12+, **only with two completed weeks and one Empujones finished without catches in easy segments**: base → surges → recovery, with surges growing 4 → 6 → 8, Cuestas every third week from ride 18, pirámide and umbral by week with more base), and a descarga week after four completed weeks in a row. Volume grows about one minute per ride up to the phase cap: 25 min of main segment in base, 35 in rotación, 45 after eight completed weeks in a row, so the 150-minute door is reachable with three rides. Two rides in a row rated "demasiado" repeat the previous phase at 80 % volume. Two hard days are never chained.
- **The ritual**: one minute still on the bike before each ride, band on. It confirms the signal, measures the day's resting pulse, and when that reading sits 8 bpm or more above the median of the last readings it offers an easy ride instead; 12 or more, it offers to rest. Once a week it also shows the safety line (chest pain, dizziness, disproportionate breathlessness: stop and consult; water and a fan at hand). It can always be skipped.
- **Stop rules inside the ride** (`RideSim.updateSafety`, fresh readings only): pulse above the profile maximum for 30 s freezes the horde and the advantage and the HUD says AFLOJA, released 3 bpm below; pulse at 95 % of maximum or more for two minutes turns the rest of the ride easy in arranque and base (`easeRemaining`: Z0–Z1 with the horde at that pace, then a cool-down) and is a warning in rotación. Health at zero offers the same switch.
- **Quitting cools down.** "Terminar" replaces what is left with two minutes of cool-down with the horde stopped; a second tap ends at once. Cutting a ride right after a surge is when dizziness is most likely, so the easy path is to cool down.
- **Improvement is measured with what a pulse can honestly give**: the pre-ride resting pulse (falls with fitness), heart-rate recovery in the minute after each surge (rises with fitness), and zone precision (share of the ride inside the prescribed zone). Each is shown against the previous window. No calories, watts, or VO2max estimates: the hardware cannot support them.

## Safety and screening

Before the first ride the app asks four questions once (chest pain or pressure on effort, dizziness or fainting, a diagnosed heart condition or uncontrolled hypertension, medication that affects the pulse). A "yes" forbids nothing: it asks the rider to consult before training hard and offers the **feel mode** (`InputMode 'feel'`): segments run by time, the cyclist rides at the prescribed pace so the horde never gains, the talk test is the guide (`talkTestCue`), and the prescribed zone is credited as done. Beta blockers make heart-rate zones meaningless, and that mode is the honest answer. The screening can be reopened from the camp ("Antes de entrenar"). The app is not a medical device and says so: a wrist optical pulse guides, it does not diagnose. The rule that never bends: the game never asks for more than the zone ceiling, and it never turns a day of overdoing it into a harder tomorrow.

## Habit and progress

The health goal is the habit, so the game measures the habit and nothing else. Everything is derived from the list of stored sessions (`src/sim/progress.ts`, pure and unit tested, fed by `src/storage/sessionStore.ts`):

- **Weekly goal with two doors**: 3 rides a week *or* 150 minutes in zone 2 or above (the WHO moderate-activity guideline). Crossing either door completes the week. A ride counts once it lasts five minutes; a ride cut short is saved, never discarded.
- **The streak counts weeks, not days**, and forgives one missed week between two completed ones. A daily streak punishes the beginner and breaks the habit it pretends to build.
- **The Route**: every kilometre of every ride adds up to a single journey with named refuges as milestones. They are markers on the road, not a story.
- **Personal records and health**: first ride without being caught, longest ride, best cardio minutes, and the resting heart-rate trend, which is the most honest indicator of improvement this hardware can give.
- **Today's ride**: a recommendation by level and by what the week already holds. Beginners get short, slow rides ("Primera salida") before the rotation base → surges → recovery kicks in; two hard days are never chained.
- **The next ride has a day.** The summary asks "¿Cuándo vuelves?" with three days; the camp then says "Te esperan el jueves", and if the day passes, "La horda sigue ahí" without drama. No notifications: the stated intention is what works.
- **Ten minutes** ("Solo diez minutos" in the camp): a fixed three-plus-seven recovery ride for bad days. It counts for the week and keeps the streak; it usually ends up being twenty.
- **The weekly review**: the first time the app opens in a new week (after the screening, only with something to tell), one screen with last week against the one before, streak, resting pulse, and the plan for the week that starts.
- **The ghost**: on a program already completed with the same duration, a pale silhouette shows where the rider's advantage was last time at the same minute (`gapTrace`, sampled every 5 s and stored with the session). Competing with yourself is the strongest motivator for a solo rider and touches no prescription.
- **One decision per ride**: in Fondo, once, past 40 % of the ride, with no catches and a normal resting pulse, the horde offers "¿Un empujón?": a minute in Z3 for 200 m of Route. Declining costs nothing; not answering is declining.

Deliberately excluded (decided 2026-09-13): cosmetic unlockables, XP, levels. The reward is the sunrise at the end of the ride and the numbers moving. The habit tools above (a committed day, the ten-minute ride, the review, the ghost, the push) are not unlockables either: they are the training and the habit, made visible.

## Phasing

**Phase 0 — playable, no hardware.** Done. Full game loop, slider-driven cadence, placeholder art, one hardcoded program. The fun gate passed on 2026-08-29.

**Phase 1 — real input.** Re-scoped on 2026-09-13: the rider decided not to buy a cadence sensor. The real input is **heart rate**, from a Huawei Band 9 broadcasting the standard Heart Rate profile, and the effort fraction (Karvonen, heart-rate reserve) drives player speed through a hand-tuned effort → km/h table. BLE CSC cadence stays implemented behind the same input interface as a future option; the fake cadence source stays too. Still open: tuning the effort table against real rides.

**Phase 2 — training system.** Done. Program catalogue with light adjustments, heart-rate integration, rider profile with rest and comfortable-pace tests plus self-correcting calibration, session history in IndexedDB, post-session summary, and the habit layer above. Deferred on purpose: closed-loop zombie speed (the effort table already closes the loop through the rider's pulse) and loading programs by fetch (the TypeScript catalogue has the same shape as the JSON).

**Phase 3 — optional.** ESP32 reading the bike's own reed switch and re-broadcasting as standard CSC, removing the dependency on the purchased sensor. Firmware, not app work.

## Sound

Everything is synthesized in WebAudio (wind, crickets, birds, the proximity drone and heartbeat, thunder, the catch hit) except eight short clips in `assets/sfx` that the rider supplied on 2026-09-14. They are the only binary assets in the game; art stays by code. `src/game/sfx.ts` fetches them at load, decodes them once the AudioContext exists, plays them (or a window of them) with envelopes, and chains a clip with itself through a crossfade (`CrossfadeLoop`) when something has to sound continuous. If a clip fails to load, the synthesized version takes its place where one exists, or it stays silent.

- **The horde** (`src/game/proximityAudio.ts`): one bus panned slightly left, because the horde is behind. Moans and voiced growls come by closeness, the running clip follows `Horde.run01`, the scream marks the start of a surge and the catch, the bite the catch.
- **The bike** (`src/game/bikeAudio.ts`): six-second windows of the pedalling clip chained with a crossfade, volume and pitch by the rider's speed (silent when stopped), and a short window of the chain clip as a gear shift when a new segment starts.
- **The night** (`src/game/ambientAudio.ts`): the ambient bed is chained without its tail, kept very low, follows `night01` and dies at dawn, under the synthesized wind and crickets.

## Anti-goals

Do not build 3D. A 2.5D parallax side-scroller delivers the sensation at a fraction of the cost.

Do not build a backend, accounts, or cloud sync in v1. Session history goes in IndexedDB. This is a single-user app for one tablet.

Do not add procedural terrain, story, cosmetic unlockables, or multiplayer. They are all more appealing to build than the calibration work, which is exactly why they need to be held back. Habit metrics (weekly goal, streak, the Route, records) are not unlockables: they are the point, and they shipped with Phase 2.

Do not model physics until the lookup table demonstrably fails.

## Working agreements

Propose a plan before writing code for anything spanning more than one file. Keep the BLE layer, the simulation, and the rendering separate enough that the simulation can be unit tested with no browser and no Phaser. Prefer small commits with running code at each step over large correct-in-theory refactors.

# Home Assistant Raven House Cards

This repository contains the Raven House Lovelace/dashboard cards for Home Assistant.

Cards included:

- `rh-jobs-card`
- `rh-quiz-card`
- `rh-quiz-master-card`
- `rh-quiz-round-card`
- `rh-soundboard-card`

These cards consume entities/services provided by the backend integration repository `ha-raven-house` (`raven_house_tools`).

## Installation

### HACS
1. Add this repository as a custom repository in HACS.
2. Set the repository type to `Dashboard`.
3. Install the repository.
4. Reload Home Assistant frontend.

### Add Resources

Add the resources you use from `/hacsfiles/ha-raven-house-cards/`.

Example resource entries:

```yaml
resources:
  - url: /hacsfiles/ha-raven-house-cards/rh-jobs-card.js
    type: module
  - url: /hacsfiles/ha-raven-house-cards/rh-quiz-card.js
    type: module
  - url: /hacsfiles/ha-raven-house-cards/rh-quiz-master-card.js
    type: module
  - url: /hacsfiles/ha-raven-house-cards/rh-quiz-round-card.js
    type: module
  - url: /hacsfiles/ha-raven-house-cards/rh-soundboard-card.js
    type: module
```

## Card Examples

### RH Jobs

```yaml
type: custom:rh-jobs-card
show_images: true
orientation: vertical
job_entities:
  - binary_sensor.rh_jobs_trash_day
  - binary_sensor.rh_jobs_laundry
```

### RH Quiz Summary

```yaml
type: custom:rh-quiz-card
show_winner: true
show_leaderboard: true
show_round_leaderboard: true
show_disabled: false
max_players: 10
```

### RH Quiz Master

```yaml
type: custom:rh-quiz-master-card
point_buttons: [5, 10]
compact: false
show_photos: true
```

### RH Quiz Round

```yaml
type: custom:rh-quiz-round-card
title: Quiz Rounds
```

### RH Soundboard

```yaml
type: custom:rh-soundboard-card
title: RH Soundboard
columns: 5
target: media_player.living_room_speaker
allow_target_switch: true
dead_air_media: media-source://media_source/local/soundboard/dead_air.mp3
clips:
  - id: air_horn
    label: Air Horn
    icon: mdi:bullhorn
    type: sfx
    fg_color: "#ffffff"
    bg_color: "#c0392b"
    media: media-source://media_source/local/sfx/air_horn.mp3
```

Clip fields:

- `id`: stable identifier for the button
- `label`: button text
- `icon`: Material Design icon
- `type`: clip category label shown on the button
- `media`: media-source or URL/path to an audio file
- `fg_color`: optional per-button foreground/text color
- `bg_color`: optional per-button background color

## Example Dashboard

See `examples/quiz-tv-dashboard.yaml` for a larger dashboard example.

## Notes

- Install `ha-raven-house` as an `Integration` repository in HACS for backend entities/services.
- Hard refresh browser cache after card upgrades when kiosk/remote sessions are pinned.

## License

MIT

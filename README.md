# Home Assistant Raven House Cards

This repository contains the Raven House Lovelace/dashboard cards for Home Assistant.

Cards included:

- `rh-jobs-card`
- `rh-notes-card`
- `rh-quiz-card`
- `rh-quiz-master-card`
- `rh-quiz-round-card`
- `rh-soundboard-card`
- `rh-timer-card`

These cards consume entities/services provided by the backend integration repository `ha-raven-house` (`raven_house_tools`).

## Installation

### HACS
1. Add this repository as a custom repository in HACS.
2. Set the repository type to `Dashboard`.
3. Install the repository.
4. Reload Home Assistant frontend.

### Add Resources

Add the resources you use from `/hacsfiles/ha-raven-house-cards/`.

Recommended standard HACS resource (loads all Raven House cards from the bundled entry file):

```yaml
resources:
  - url: /hacsfiles/ha-raven-house-cards/ha-raven-house-cards.js
    type: module
```

### Source Layout and Build

- Source files live in `src/cards/` and are bundled via `src/index.js`.
- The distributed file `ha-raven-house-cards.js` is generated from source and should not be edited directly.

Build locally:

```bash
npm install
npm run build
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
title: RH Quiz Card
show_winner: true
show_leaderboard: true
show_round_leaderboard: true
show_round_leaderboard_name: true
show_round_info: true
show_disabled: false
max_players: 10
winner_score: overall
leaderboard_score: overall
photo_size: 48
text_size: 1
winner_image_size: 320
round_info_bg_color: "#0f4c81"
round_info_fg_color: "#ffffff"
next_round_info_bg_color: "#7a2f24"
next_round_info_fg_color: "#ffffff"
```

Quiz card settings:

- `title` (string): Card header. Use `""` to hide the header.
- `show_winner` (boolean, default `true`): Show/hide the current winner section.
- `show_leaderboard` (boolean, default `true`): Show/hide the main leaderboard.
- `show_round_leaderboard` (boolean, default `true`): Show/hide the round leaderboard.
- `show_round_leaderboard_name` (boolean, default `true`): Show/hide the active round name line above the round leaderboard. Set this to `false` to remove that line entirely if the round name is already shown elsewhere.
- `show_round_info` (boolean, default `false`): Show/hide the active round info banner.
- `show_disabled` (boolean, default `false`): Include disabled players in rankings.
- `max_players` (number, default `10`): Maximum number of quiz players to show.
- `winner_score` (`overall` or `total`, default `overall`): Score basis for the winner card.
- `leaderboard_score` (`overall`, `total`, or `round`, default `overall`): Score basis for the main leaderboard.
- `photo_size` (number, default `36`): Avatar size in leaderboard rows.
- `text_size` (number, default `1`): Scales quiz-card text for positions, names, scores, and section labels.
- `winner_image_size` (number, default `max(220, photo_size * 3)`): Maximum rendered winner-image size in pixels. The winner image scales responsively to available width and is no longer cropped.
- `round_info_bg_color` (string, default `var(--primary-color)`): Background color for the round info banner while a round is active.
- `round_info_fg_color` (string, default `var(--text-primary-color,#fff)`): Foreground/text color for the round info banner.
- `next_round_info_bg_color` (string, default `var(--accent-color,#b85042)`): Background color for the round info banner during breaks (no active round).
- `next_round_info_fg_color` (string, default `round_info_fg_color`): Foreground/text color for the round info banner during breaks.

Round info banner behavior:

- When a round is active, the banner shows `Round x of Y`, the active round name, and `Next round: <name>`. If there is no next round, the final line is left blank.
- When no round is active, the banner shows `Y Rounds` and `Next Round: <name>` based on the currently remembered round position.

### RH Quiz Master

```yaml
type: custom:rh-quiz-master-card
title: RH Quiz Master Control
point_buttons: [5, 10]
compact: false
show_photos: true
text_size: 1
```

Quiz master settings:

- `title` (string): Card header. Use `""` to hide the header.
- `point_buttons` (number array, default `[5, 1, -1, -5]`): Scoring buttons shown for each player. Positive numbers add points; negative numbers remove points.
- `compact` (boolean, default `false`): Use a denser player layout with smaller spacing.
- `show_photos` (boolean, default `false`): Show/hide player avatars.
- `text_size` (number, default `1`): Scales quiz-master text for labels, names, scores, and button text.

Quiz master round control behavior:

- Shows `End Round` while a round is active.
- Shows `Start Round` during a break (no active round).

### RH Quiz Round

```yaml
type: custom:rh-quiz-round-card
title: Quiz Rounds
text_size: 1
```

Quiz round settings:

- `title` (string): Card header. Use `""` to hide the header.
- `text_size` (number, default `1`): Scales quiz-round text for input, labels, round names, and action buttons.

Quiz round controls:

- `Set Active` marks a round as currently running.
- `Set Position` sets the remembered position used for `Start Round` during breaks without activating that round.

### Global Sizing Tips

Use these starting points to tune readability across quiz cards (`rh-quiz-card`, `rh-quiz-master-card`, and `rh-quiz-round-card`):

- TV / wall display (3m+ viewing distance): set `text_size: 1.25` to `1.5`, `photo_size: 56` to `72`, and `winner_image_size: 360` to `520`.
- Tablet / countertop dashboard: set `text_size: 1.05` to `1.2`, `photo_size: 40` to `56`, and `winner_image_size: 280` to `380`.
- Phone / compact panel: set `text_size: 0.9` to `1`, `photo_size: 28` to `40`, and `winner_image_size: 220` to `300`.

Quick rules of thumb:

- Increase `text_size` first for readability, then adjust `photo_size`.
- Keep `winner_image_size` roughly `5x` to `8x` your `text_size` baseline body text height to avoid clipping and maintain visual balance.
- In tight layouts, combine `compact: true` (quiz master) with a modest `text_size` increase instead of very large `photo_size`.

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

### RH Timer

```yaml
type: custom:rh-timer-card
title: Kitchen Timers
entity:
  - timer.kitchen
  - timer.utility
default_entity: timer.utility
quick_buttons:
  - label: 1m
    duration: "00:01:00"
  - label: 5m
    duration: "00:05:00"
```

Timer settings:

- `entity` (string or string array, optional): Timer entity or entities to show. When omitted, the card discovers all `timer.*` entities automatically.
- `default_entity` (string, required when `entity` is omitted): Timer used for quick-start buttons and preferred single-timer display. When `entity` is provided, `default_entity` must match it or be included in the list.
- `title` (string, default `friendly_name` of the selected timer): Card header. Use `""` to hide the header.
- `color` (string, default theme primary color): Base countdown color while above thresholds.
- `quick_buttons` (array): Idle-state quick-start buttons in `{ label, duration }` form.
- `thresholds` (array): Countdown color thresholds in `{ seconds, color }` form, checked from highest `seconds` to lowest.
- `complete_color` (string, default theme error color): Color used when the timer is complete.

### RH Notes

```yaml
type: custom:rh-notes-card
title: RH Notes
entity_id: sensor.kitchen_note
fg_color: "#1f1f1f"
```

Notes settings:

- `title` (string, default `RH Notes`): Card header. Use `""` to hide the header.
- `entity_id` (string): Entity whose state is rendered as the note text.
- `fg_color` (string, default theme text color): Foreground color for both the title and the note text.
- `edit_on_click` (boolean, default `true`): When enabled, clicking the note opens the linked entity details so its value can be edited.

The card stays transparent apart from the header and the note text itself, and it automatically reflects entity state changes.

## Example Dashboard

See `examples/quiz-tv-dashboard.yaml` for a larger dashboard example.

## Notes

- Install `ha-raven-house` as an `Integration` repository in HACS for backend entities/services.
- This repository ships the combined bundle `ha-raven-house-cards.js` as the supported dashboard resource.
- Hard refresh browser cache after card upgrades when kiosk/remote sessions are pinned.

## License

MIT

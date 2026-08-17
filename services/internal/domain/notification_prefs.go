package domain

import (
	"encoding/json"
	"time"
)

// NotificationPrefs is the whole of `user.notification_prefs`, in one place.
//
// It was in two. The notification engine read `muted` in notifications.go and the digest read
// `emailDigest` and `emailPerNotification` in digest.go, each with its own anonymous struct
// and its own idea of the shape — and the two disagreed with the client, which is the third
// place the shape was written down.
//
// The disagreement was not academic. The client declares
//
//	readonly muted?: readonly NotificationType[]
//
// and the engine decoded `map[string]bool`. Unmarshalling `["comment"]` into a map fails, and
// both decoders are deliberately lenient — an unparseable bag mutes nothing — so a user who
// muted a notification type was silently not muted. It failed in the safe direction, which is
// exactly why nobody would ever report it: the notification they asked not to receive kept
// arriving, and there was nothing to see anywhere else.
//
// So: one struct, and `TestNotificationPrefsMatchTheClient` reads the keys out of
// web/src/store/types.ts and fails when they drift. A shape shared across two languages has no
// compiler holding it together, and prose in two doc comments is not a substitute for one.
//
// Reading stays lenient and per-key. An unknown key is ignored so that adding a preference is
// not a change to the notification engine, and an absent key means its default so that a
// client built before a preference existed keeps working.
type NotificationPrefs struct {
	// Muted is the notification types this person has switched off entirely, in every
	// channel. An array, matching the client: it is a set of types, and JSON's way of
	// spelling a set is a list.
	Muted []string `json:"muted"`
	// EmailDigest is the cadence: off, hourly, daily or weekly. Absent means daily.
	EmailDigest *string `json:"emailDigest"`
	// EmailPerNotification asks for an email per notification instead of the digest. A
	// preference, never a default — see the M1 scope table.
	EmailPerNotification *bool `json:"emailPerNotification"`
}

// The digest cadences. Off is a real choice and not the absence of one, which is why it is a
// value here rather than a nil pointer somewhere.
const (
	cadenceOff    = "off"
	cadenceHourly = "hourly"
	cadenceDaily  = "daily"
	cadenceWeekly = "weekly"
)

// defaultCadence is what somebody who has never opened the preferences screen gets.
const defaultCadence = cadenceDaily

// parseNotificationPrefs decodes the bag, or returns the defaults.
//
// A bag that will not parse yields the defaults rather than an error. Failing the other way
// would silently stop delivering to that user, and nobody reports a notification that never
// arrived — where an unwanted one is reported within the hour.
func parseNotificationPrefs(raw json.RawMessage) NotificationPrefs {
	var prefs NotificationPrefs
	if len(raw) == 0 {
		return prefs
	}
	if err := json.Unmarshal(raw, &prefs); err != nil {
		return NotificationPrefs{}
	}
	return prefs
}

// mutedTypes is the set of types this person has switched off, as a lookup.
//
// A map rather than the slice, because the fan-out asks "is this type muted" once per
// recipient per event and a linear scan of a slice inside that loop is the one place the
// shape of this bag could matter for performance.
func mutedTypes(raw json.RawMessage) map[string]bool {
	muted := parseNotificationPrefs(raw).Muted
	if len(muted) == 0 {
		return nil
	}
	out := make(map[string]bool, len(muted))
	for _, name := range muted {
		out[name] = true
	}
	return out
}

// emailPrefs is the delivery half of the bag, resolved.
type emailPrefs struct {
	Cadence         string
	PerNotification bool
}

func emailPrefsOf(raw json.RawMessage) emailPrefs {
	bag := parseNotificationPrefs(raw)
	out := emailPrefs{Cadence: defaultCadence}

	if bag.EmailDigest != nil {
		switch *bag.EmailDigest {
		case cadenceOff, cadenceHourly, cadenceDaily, cadenceWeekly:
			out.Cadence = *bag.EmailDigest
		}
		// An unrecognised cadence falls back to the default rather than to "off". A typo in a
		// preference should not silently stop somebody's mail.
	}
	if bag.EmailPerNotification != nil {
		out.PerNotification = *bag.EmailPerNotification
	}
	return out
}

// interval is how long this cadence waits between messages.
func (p emailPrefs) interval() time.Duration {
	switch p.Cadence {
	case cadenceHourly:
		return time.Hour
	case cadenceWeekly:
		return 7 * 24 * time.Hour
	default:
		return 24 * time.Hour
	}
}

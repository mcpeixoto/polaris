package domain

import (
	"github.com/peixotolabs/polaris/services/internal/domain/model"
	"github.com/peixotolabs/polaris/services/internal/platform"
)

func validateProjectUpdateReminderFields(interval, weekday, hour *int) error {
	if interval != nil && (*interval < 1 || *interval > 365) {
		return platform.Validation("projectUpdateReminderIntervalDays",
			"reminder interval must be between 1 and 365 days")
	}
	if weekday != nil && (*weekday < 0 || *weekday > 6) {
		return platform.Validation("projectUpdateReminderWeekday",
			"reminder weekday must be 0 (Sunday) through 6 (Saturday)")
	}
	if hour != nil && (*hour < 0 || *hour > 23) {
		return platform.Validation("projectUpdateReminderHour",
			"reminder hour must be 0 through 23")
	}
	return nil
}

func validateProjectUpdateSchedule(schedule *string) error {
	if schedule == nil {
		return nil
	}
	switch *schedule {
	case model.ProjectUpdateScheduleDefault,
		model.ProjectUpdateScheduleNever,
		model.ProjectUpdateScheduleCustom:
		return nil
	default:
		return platform.Validation("updateSchedule", "schedule must be default, custom, or never")
	}
}

func int16PtrFromInt(v *int) *int16 {
	if v == nil {
		return nil
	}
	n := int16(*v)
	return &n
}

func intPtrFromInt16(v *int16) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

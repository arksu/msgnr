package events

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseNotificationPayload_Valid(t *testing.T) {
	cases := []struct {
		payload  string
		expected int64
	}{
		{"1", 1},
		{"42", 42},
		{"9999999999", 9999999999},
	}

	for _, tc := range cases {
		seq, err := parseNotificationPayload(tc.payload)
		require.NoError(t, err, "payload=%q", tc.payload)
		assert.Equal(t, tc.expected, seq)
	}
}

func TestParseNotificationPayload_Invalid(t *testing.T) {
	cases := []string{
		"",
		"abc",
		"1.5",
		"12 34",
		"{}",
	}

	for _, payload := range cases {
		_, err := parseNotificationPayload(payload)
		assert.Error(t, err, "expected error for payload=%q", payload)
	}
}

package roster

import (
	"slices"
	"testing"
)

func TestParsePaste(t *testing.T) {
	for _, c := range []struct {
		in   string
		want []string
	}{
		{"№\tПрізвище\tІм'я\r\n1\tКоваль\tДмитро\r\n2.\tОлійник\tДарина\r\n", []string{"Коваль Дмитро", "Олійник Дарина"}},
		{"ПІБ\n3\tМороз\t\tНазар\n", []string{"Мороз Назар"}},
		{"1. Іванов Петро", []string{"Іванов Петро"}},
		{"12) Іванов Петро", []string{"Іванов Петро"}},
		{"1.Іванов Петро", []string{"Іванов Петро"}},
		{"1)\tІванов\tПетро", []string{"Іванов Петро"}},
		{"№ з/п\tПрізвище, ім’я\n1\tІванов Петро", []string{"Іванов Петро"}},
		{"Мороз Назар\n\n  Бойко Андрій ", []string{"Мороз Назар", "Бойко Андрій"}},
	} {
		if got := ParsePaste(c.in); !slices.Equal(got, c.want) {
			t.Errorf("ParsePaste(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeApostrophesAndNFC(t *testing.T) {
	want := "Мар’яна Їжак"
	for _, in := range []string{
		"Мар'яна Їжак",
		"Марʼяна Їжак",
		"Мар`яна Їжак",
		"Мар‘яна Їжак",
		"Мар′яна Їжак",
		"Мар’яна І\u0308жак", // decomposed Ї
		"  Мар’яна \t Їжак ",
	} {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSortUkrainian(t *testing.T) {
	names := []string{"Іваненко", "Єрмак", "Ґудзь", "Антоненко", "Яковенко"}
	Sort(names)
	want := []string{"Антоненко", "Ґудзь", "Єрмак", "Іваненко", "Яковенко"}
	if !slices.Equal(names, want) {
		t.Fatalf("got %q, want %q", names, want)
	}
}

func TestSortKeyMatchesSort(t *testing.T) {
	names := []string{"Іваненко", "Єрмак", "Ґудзь", "Антоненко", "Яковенко", "Мар'яна", "Марʼяна"}
	byKey := slices.Clone(names)
	slices.SortStableFunc(byKey, func(a, b string) int {
		ka, kb := SortKey(a), SortKey(b)
		switch {
		case ka < kb:
			return -1
		case ka > kb:
			return 1
		}
		return 0
	})
	sorted := slices.Clone(names)
	Sort(sorted)
	if !slices.Equal(byKey, sorted) {
		t.Fatalf("by key %q, by Sort %q", byKey, sorted)
	}
}

func TestDisambiguateDuplicates(t *testing.T) {
	in := []string{"Коваль Дмитро", "Коваль Дмитро", "Мороз Назар", "Коваль  Дмитро"}
	got := Disambiguate(in)
	want := []string{"Коваль Дмитро", "Коваль Дмитро (2)", "Мороз Назар", "Коваль Дмитро (3)"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
	if in[1] != "Коваль Дмитро" {
		t.Fatalf("input modified: %q", in)
	}
}

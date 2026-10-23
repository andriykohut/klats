package roster

import (
	"slices"
	"testing"
)

func TestParsePasteExcelRows(t *testing.T) {
	got := ParsePaste("№\tПрізвище\tІм'я\r\n1\tКоваль\tДмитро\r\n2.\tОлійник\tДарина\r\n")
	want := []string{"Коваль Дмитро", "Олійник Дарина"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParsePasteSkipsHeaderPIB(t *testing.T) {
	got := ParsePaste("ПІБ\n3\tМороз\t\tНазар\n")
	want := []string{"Мороз Назар"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParsePasteNumberedLists(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"1. Іванов Петро", "Іванов Петро"},
		{"12) Іванов Петро", "Іванов Петро"},
		{"1.Іванов Петро", "Іванов Петро"},
		{"1)\tІванов\tПетро", "Іванов Петро"},
		{"№ з/п\tПрізвище, ім’я\n1\tІванов Петро", "Іванов Петро"},
	} {
		if got := ParsePaste(c.in); !slices.Equal(got, []string{c.want}) {
			t.Errorf("ParsePaste(%q) = %q, want [%q]", c.in, got, c.want)
		}
	}
}

func TestParsePastePlainLines(t *testing.T) {
	got := ParsePaste("Мороз Назар\n\n  Бойко Андрій ")
	want := []string{"Мороз Назар", "Бойко Андрій"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
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

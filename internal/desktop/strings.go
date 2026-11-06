package desktop

// texts are the shell's own UI strings in one language; the teacher app has
// its own. testFile and backupFile name the file types in the save dialog.
type texts struct {
	title, show, quit, cancel, quitAsk string
	testFile, backupFile               string
}

var (
	uk = texts{
		title: "Клац", show: "Показати вікно", quit: "Вийти", cancel: "Скасувати", quitAsk: "Тест ще триває. Вийти?",
		testFile: "Тест Клацу", backupFile: "Резервна копія Клацу",
	}
	en = texts{
		title: "Klats", show: "Show window", quit: "Quit", cancel: "Cancel", quitAsk: "A test is still running. Quit?",
		testFile: "Klats test", backupFile: "Klats backup",
	}
)

// textsFor returns the strings for lang: English for "en", Ukrainian
// otherwise.
func textsFor(lang string) texts {
	if lang == "en" {
		return en
	}
	return uk
}

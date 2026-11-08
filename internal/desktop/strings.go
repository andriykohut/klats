package desktop

// texts are the shell's own UI strings in one language; the teacher app has
// its own. testFile and backupFile name the file types in the save dialog.
// The rest are [App.Fail]'s: tooNew* for data from a newer version, fail*
// for any other error.
type texts struct {
	title, show, quit, cancel, quitAsk  string
	testFile, backupFile                string
	tooNewTitle, tooNewText, download   string
	failTitle, failText, showLog, close string
}

var (
	uk = texts{
		title: "Клац", show: "Показати вікно", quit: "Вийти", cancel: "Скасувати", quitAsk: "Тест ще триває. Вийти?",
		testFile: "Тест Клацу", backupFile: "Резервна копія Клацу",
		tooNewTitle: "Не вдалося відкрити дані Клацу",
		tooNewText:  "Їх збережено новішою версією Клацу. Установіть її з сайту, щоб далі працювати з цими тестами й результатами.",
		download:    "Відкрити сайт",
		failTitle:   "Клац не запустився",
		failText:    "Під час запуску сталася помилка. Подробиці записано в журнал:",
		showLog:     "Показати журнал",
		close:       "Закрити",
	}
	en = texts{
		title: "Klats", show: "Show window", quit: "Quit", cancel: "Cancel", quitAsk: "A test is still running. Quit?",
		testFile: "Klats test", backupFile: "Klats backup",
		tooNewTitle: "Klats can’t open its data",
		tooNewText:  "They were saved by a newer version of Klats. Install it from the website to keep working with these tests and results.",
		download:    "Open the website",
		failTitle:   "Klats didn’t start",
		failText:    "Something went wrong at startup. The details are in the log:",
		showLog:     "Show the log",
		close:       "Close",
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

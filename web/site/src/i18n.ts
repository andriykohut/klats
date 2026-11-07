/*
 * Every string on the site, Ukrainian first; English has the same shape, so
 * one page renders either language. Body text on the help pages may hold
 * inline markup (code, b) and is rendered with set:html; headings, labels and
 * the front page are plain text.
 */

export type Lang = "uk" | "en";

/** A screen no script can take: shown as a dashed box until captured by hand. */
export interface Slot {
  /** The capture's file name, without extension, as listed in SLOTS.md. */
  file: string;
  caption: string;
}

/** The app screens in src/assets/shots/<lang>/. */
export type ShotName = "live" | "builder" | "student" | "results";

const uk = {
  name: "Клац",
  description:
    "Безкоштовна програма для тестів у комп’ютерному класі: без інтернету, без реєстрації й без установлення на учнівські ПК.",
  nav: { install: "Як установити", help: "Допомога", other: "EN" },
  footer: {
    install: "Як установити",
    firstLesson: "Перший урок",
    faq: "Питання й відповіді",
    github: "GitHub",
  },
  download: {
    win: ["Завантажити для Windows", "Windows 10 і 11"],
    mac: ["Завантажити для macOS", "macOS 13 або новіша"],
    linux: ["Завантажити для Linux", "AppImage"],
    links: {
      win: "Windows",
      mac: "macOS",
      linux: "Linux",
      deb: ".deb",
      offline: "інсталятор без інтернету",
    },
  },
  shots: {
    live: "Журнал тесту наживо: учні, їхні відповіді й події",
    builder: "Редактор тесту з питанням і варіантами відповідей",
    student: "Екран учня з полем для коду тесту",
    results: "Результати класу з оцінками кожного учня",
  } satisfies Record<ShotName, string>,
  front: {
    title: "Клац — тести в комп’ютерному класі",
    h1: "Тести в комп’ютерному класі — без інтернету й реєстрації",
    lead: "Безкоштовна програма для вчителя. Учні відповідають у браузері на шкільних ПК, а ви бачите весь клас наживо й одразу отримуєте оцінки.",
    steps: [
      {
        h: "Складіть тест — або відкрийте старий",
        p: "15 типів питань, формули, малюнки й код. Файли .mtf відкриваються самі.",
        shot: "builder",
      },
      {
        h: "Учні вводять код з дошки",
        p: "Лише браузер, нічого не встановлювати. Працює навіть на старих ПК з Windows 7.",
        shot: "student",
      },
      {
        h: "Стежте за класом наживо",
        p: "Хто що відповів, хто застряг. Додайте час або пересадіть учня за інший ПК.",
        shot: "live",
      },
      {
        h: "Оцінки — одразу",
        p: "12-бальна шкала, бали за темами, файл Excel.",
        shot: "results",
      },
    ] satisfies { h: string; p: string; shot: ShotName }[],
    more: "А ще",
    cards: [
      [
        "Без інтернету",
        "Усе працює в мережі школи. Зник Wi-Fi — відповіді не губляться.",
      ],
      ["Кожному — свої питання", "Випадковий набір за тегами."],
      ["Без реєстрації", "Дані не залишають школу."],
      ["Безкоштовно", "Відкритий код, ліцензія GPL."],
    ],
  },
  install: {
    title: "Як установити",
    intro:
      "Клац ставлять лише на комп’ютер учителя. На учнівських ПК нічого встановлювати не треба: учні відкривають тест у браузері, а на старих ПК з Windows 7 підійде Chrome 109 або Firefox 115.",
    toDownload: "Інсталятори для всіх систем — на головній сторінці",
    windows: {
      intro: "Підійде Windows 10 або 11.",
      steps: [
        {
          text: "Завантажте <code>Klats-Setup.exe</code> і запустіть його. Якщо на комп’ютері немає інтернету, беріть інсталятор без інтернету — <code>Klats-Setup-Offline.exe</code>.",
        },
        {
          text: "Windows може показати синє вікно «Windows захистив ваш ПК»: таке вікно з’являється для нових програм, які ще мало хто завантажував. Натисніть «Докладніше», а потім «Усе одно запустити».",
          slots: [
            {
              file: "windows-smartscreen",
              caption: "Знімок: вікно «Windows захистив ваш ПК»",
            },
            {
              file: "windows-run-anyway",
              caption:
                "Знімок: те саме вікно після «Докладніше», з кнопкою «Усе одно запустити»",
            },
          ],
        },
        {
          text: "Windows спитає, чи дозволити програмі вносити зміни на пристрої. Натисніть «Так»: інсталятор установить Клац для всіх користувачів комп’ютера й налаштує брандмауер, щоб учні могли підключитися.",
          slots: [
            {
              file: "windows-uac",
              caption:
                "Знімок: запит «Дозволити цій програмі вносити зміни на вашому пристрої?»",
            },
          ],
        },
        {
          text: "Пройдіть кроки інсталятора, і Клац з’явиться в меню «Пуск».",
        },
      ] as { text: string; slots?: Slot[] }[],
      admin: {
        h: "Якщо немає прав адміністратора",
        p: "Інсталятор просить прав адміністратора. Якщо їх у вас немає, попросіть шкільного адміністратора:",
        list: [
          "установити Клац на ваш комп’ютер — брандмауер Windows інсталятор налаштує сам;",
          "якщо в школі є інший брандмауер чи антивірус, дозволити в ньому Клацу вхідні з’єднання з локальної мережі;",
          "перевірити, що ваш комп’ютер і учнівські ПК в одній мережі й можуть з’єднуватися між собою.",
        ],
      },
    },
    mac: {
      intro:
        "Потрібна macOS 13 або новіша. Підійде Mac з процесором Apple чи Intel.",
      steps: [
        { text: "Завантажте <code>Klats.dmg</code> і відкрийте його." },
        {
          text: "Перетягніть Клац у папку «Програми».",
          slots: [
            {
              file: "mac-dmg",
              caption: "Знімок: вікно Klats.dmg з Клацом і папкою «Програми»",
            },
          ],
        },
        {
          text: "Відкрийте Клац із папки «Програми». Першого разу macOS не дасть його відкрити, бо програма не підписана в Apple. Закрийте повідомлення — лише не переносьте Клац у Кошик.",
          slots: [
            {
              file: "mac-not-opened",
              caption: "Знімок: повідомлення macOS, що Клац не відкрито",
            },
          ],
        },
        {
          text: "Відкрийте «Системні параметри» → «Приватність і безпека», прокрутіть донизу й натисніть «Усе одно відкрити» біля рядка про Клац.",
          slots: [
            {
              file: "mac-privacy",
              caption:
                "Знімок: «Приватність і безпека» з кнопкою «Усе одно відкрити»",
            },
          ],
        },
        {
          text: "Ще раз натисніть «Усе одно відкрити» й уведіть пароль від Mac. Далі Клац відкриватиметься як звичайна програма.",
        },
      ] as { text: string; slots?: Slot[] }[],
    },
    linux: {
      intro:
        "Клац працює на Ubuntu 24.04, Linux Mint 22, Debian 13, Fedora 40 і новіших версіях, на комп’ютерах з 64-бітним процесором Intel чи AMD. Виберіть один із двох файлів:",
      options: [
        "<b>Пакет .deb</b> — для Ubuntu, Linux Mint і Debian. Відкрийте <code>klats_amd64.deb</code> у програмі встановлення або виконайте в терміналі <code>sudo apt install ./klats_amd64.deb</code>. Клац з’явиться в меню програм.",
        "<b>AppImage</b> — для будь-якої з цих систем, зокрема Fedora, і працює без установлення. Дозвольте файлу <code>Klats-x86_64.AppImage</code> запускатися як програмі (у його властивостях або командою <code>chmod +x Klats-x86_64.AppImage</code>) і запустіть його.",
      ],
    },
    uninstall: {
      h: "Як видалити Клац",
      list: [
        "<b>Windows.</b> Видаліть Клац у «Параметрах» → «Програми», як будь-яку іншу програму. Наприкінці програма видалення спитає: «Також видалити мої тести й результати?» Якщо відповісти «Так», вона видалить папку даних того користувача, який видаляє Клац, — <code>%AppData%\\Klats</code>: усі тести, класи, результати й налаштування. Типово вибрано «Ні»: тоді дані лишаються, і їх знову побачить Клац, якщо встановити його ще раз. Резервні копії, збережені в інших папках, не видаляються.",
        "<b>Mac.</b> Перетягніть Клац із папки «Програми» в Кошик. Дані лишаються в папці <code>~/Library/Application Support/Klats</code>; видаліть її, якщо вони вже не потрібні.",
        "<b>Linux.</b> Пакет видаляють командою <code>sudo apt remove klats</code>, а AppImage — як звичайний файл. Дані лишаються в папці <code>~/.local/share/klats</code>.",
      ],
    },
    next: "Далі: перший урок",
  },
  firstLesson: {
    title: "Перший урок",
    intro: "Від установлення до перших оцінок — десять кроків.",
    steps: [
      {
        text: "Установіть Клац на свій комп’ютер — як саме, читайте в розділі «Як установити».",
      },
      {
        text: "Підключіть комп’ютер до тієї самої мережі, що й учнівські ПК, і відкрийте Клац.",
      },
      {
        text: "У розділі «Класи» натисніть «Новий клас» і вставте список учнів з Excel або журналу.",
      },
      {
        text: "У розділі «Мої тести» натисніть «Новий тест» і додайте питання — або натисніть «Відкрити» й виберіть готовий файл .klats чи .mtf.",
        shot: "builder",
      },
      {
        text: "Позначте правильні відповіді, а в «Налаштуваннях тесту» задайте час і шкалу оцінок.",
      },
      { text: "Натисніть «Запустити тест» і виберіть клас." },
      {
        text: "Натисніть «Показати на дошці»: там з’являться адреса для учнів і код тесту.",
      },
      {
        text: "Учні відкривають адресу в браузері, вводять код і обирають своє ім’я.",
        shot: "student",
      },
      {
        text: "Стежте за класом наживо: хто що відповів, хто без зв’язку, кому додати часу.",
        shot: "live",
      },
      {
        text: "Коли всі допишуть, натисніть «Завершити тест», а потім «Переглянути результати»: оцінки вже там, і їх можна експортувати в Excel.",
        shot: "results",
      },
    ] as { text: string; shot?: ShotName }[],
  },
  faq: {
    title: "Питання й відповіді",
    connect: {
      h: "Учні не можуть підключитися",
      p: "Найчастіше заважає одне з цього:",
      list: [
        "<b>Інша мережа.</b> Ваш комп’ютер і учнівські ПК мають бути в одній мережі. Гостьовий Wi-Fi часто не пускає пристрої один до одного, тож підключайтеся до тієї самої мережі, що й клас. Якщо комп’ютер підключений до кількох мереж, у «Налаштування → Мережа» оберіть ту, де учнівські ПК.",
        "<b>Брандмауер.</b> На Windows інсталятор сам дозволяє учнівським ПК підключатися. Якщо в школі є інший брандмауер чи антивірус, дозвольте в ньому Клац. На Mac, якщо macOS спитає про вхідні з’єднання, натисніть «Дозволити». На Linux з увімкненим брандмауером відкрийте в ньому порт Клацу.",
        "<b>Зайнятий порт.</b> Якщо порт Клацу вже зайняла інша програма, угорі вікна з’явиться попередження. Вкажіть інший номер у «Налаштування → Порт» і перезапустіть Клац.",
        "<b>Помилка в адресі.</b> Учні мають ввести адресу точно так, як на дошці, разом із числом після двокрапки, якщо воно є.",
      ],
    },
    data: {
      h: "Де зберігаються тести й результати?",
      p: "На вашому комп’ютері, у папці даних Клацу. В інтернет нічого не потрапляє.",
      list: [
        "Windows: <code>%AppData%\\Klats</code>",
        "macOS: <code>~/Library/Application Support/Klats</code>",
        "Linux: <code>~/.local/share/klats</code>, а якщо задано змінну <code>XDG_DATA_HOME</code> — <code>$XDG_DATA_HOME/klats</code>",
      ],
      backup:
        "Щоб зберегти копію всього або перенести дані на інший комп’ютер, скористайтеся «Налаштування → Резервна копія».",
    },
    update: {
      h: "Як оновити Клац?",
      p: "Завантажте нову версію й установіть її так само, як першу: на Windows — поверх старої, на Mac — замінивши Клац у папці «Програми», на Linux — новим пакетом .deb або новим файлом AppImage. Тести й результати залишаться на місці.",
      link: "Завантажити нову версію",
    },
    check: {
      h: "Як Клац дізнається про нову версію?",
      paras: [
        "Раз на день Клац дізнається на GitHub, чи вийшла нова версія. Нічого про вас чи школу не надсилається, а поки триває тест, Клац нічого не перевіряє.",
        "Коли нова версія вийде, угорі вікна з’явиться «Нова версія» з посиланням на цей сайт. Сам Клац нічого не оновлює.",
        "Щоб не перевіряти оновлень, вимкніть «Перевіряти оновлення» в «Налаштування → Про програму».",
      ],
    },
  },
};

const en: typeof uk = {
  name: "Klats",
  description:
    "A free program for tests in the computer lab: no internet, no sign-up and nothing to install on the students’ PCs.",
  nav: { install: "How to install", help: "Help", other: "УК" },
  footer: {
    install: "How to install",
    firstLesson: "First lesson",
    faq: "Questions and answers",
    github: "GitHub",
  },
  download: {
    win: ["Download for Windows", "Windows 10 and 11"],
    mac: ["Download for macOS", "macOS 13 or newer"],
    linux: ["Download for Linux", "AppImage"],
    links: {
      win: "Windows",
      mac: "macOS",
      linux: "Linux",
      deb: ".deb",
      offline: "offline installer",
    },
  },
  shots: {
    live: "The live journal: students, their answers and events",
    builder: "The test editor with a question and its choices",
    student: "The student screen with the test code field",
    results: "Class results with each student’s grade",
  },
  front: {
    title: "Klats — tests in the computer lab",
    h1: "Tests in the computer lab — no internet, no sign-up",
    lead: "A free program for the teacher. Students answer in a browser on the school PCs, while you watch the whole class live and get the grades straight away.",
    steps: [
      {
        h: "Build a test — or open an old one",
        p: "15 question types, formulas, pictures and code. .mtf files just open.",
        shot: "builder",
      },
      {
        h: "Students type the code from the board",
        p: "Just a browser, nothing to install. Works even on old Windows 7 PCs.",
        shot: "student",
      },
      {
        h: "Watch the class live",
        p: "Who answered what, who is stuck. Add time or move a student to another PC.",
        shot: "live",
      },
      {
        h: "Grades straight away",
        p: "The 12-point scale, scores by topic, an Excel file.",
        shot: "results",
      },
    ],
    more: "And also",
    cards: [
      [
        "No internet",
        "Everything runs on the school network. Wi-Fi drops, answers stay.",
      ],
      ["Questions of their own", "A random set by tag."],
      ["No sign-up", "Data never leaves the school."],
      ["Free", "Open source, GPL licence."],
    ],
  },
  install: {
    title: "How to install",
    intro:
      "Klats goes on the teacher’s computer only. Nothing is installed on the students’ PCs: they open the test in a browser, and old Windows 7 PCs can use Chrome 109 or Firefox 115.",
    toDownload: "Installers for every system are on the front page",
    windows: {
      intro: "Windows 10 or 11 will do.",
      steps: [
        {
          text: "Download <code>Klats-Setup.exe</code> and run it. If the computer has no internet, take the offline installer, <code>Klats-Setup-Offline.exe</code>.",
        },
        {
          text: "Windows may show a blue “Windows protected your PC” window: it appears for new programs that few people have downloaded yet. Click “More info”, then “Run anyway”.",
          slots: [
            {
              file: "windows-smartscreen",
              caption: "Screenshot: the “Windows protected your PC” window",
            },
            {
              file: "windows-run-anyway",
              caption:
                "Screenshot: the same window after “More info”, with the “Run anyway” button",
            },
          ],
        },
        {
          text: "Windows asks whether to allow the app to make changes to the device. Click “Yes”: the installer sets Klats up for every user of the computer and opens the firewall so students can connect.",
          slots: [
            {
              file: "windows-uac",
              caption:
                "Screenshot: the “Do you want to allow this app to make changes to your device?” prompt",
            },
          ],
        },
        {
          text: "Go through the installer’s steps, and Klats appears in the Start menu.",
        },
      ],
      admin: {
        h: "Without admin rights",
        p: "The installer asks for admin rights. If you don’t have them, ask the school’s IT person to:",
        list: [
          "install Klats on your computer — the installer sets up the Windows firewall itself;",
          "if the school runs another firewall or antivirus, allow Klats incoming connections from the local network in it;",
          "check that your computer and the students’ PCs are on one network and can reach each other.",
        ],
      },
    },
    mac: {
      intro:
        "You need macOS 13 or newer, on a Mac with an Apple or Intel chip.",
      steps: [
        { text: "Download <code>Klats.dmg</code> and open it." },
        {
          text: "Drag Klats into the Applications folder.",
          slots: [
            {
              file: "mac-dmg",
              caption:
                "Screenshot: the Klats.dmg window with Klats and the Applications folder",
            },
          ],
        },
        {
          text: "Open Klats from Applications. The first time, macOS won’t open it, because the app isn’t signed with Apple. Close the message — just don’t move Klats to the Bin.",
          slots: [
            {
              file: "mac-not-opened",
              caption: "Screenshot: macOS saying Klats was not opened",
            },
          ],
        },
        {
          text: "Open System Settings → Privacy & Security, scroll down and click “Open Anyway” next to the line about Klats.",
          slots: [
            {
              file: "mac-privacy",
              caption:
                "Screenshot: Privacy & Security with the “Open Anyway” button",
            },
          ],
        },
        {
          text: "Click “Open Anyway” once more and enter your Mac password. From then on Klats opens like any other app.",
        },
      ],
    },
    linux: {
      intro:
        "Klats runs on Ubuntu 24.04, Linux Mint 22, Debian 13, Fedora 40 and newer, on computers with a 64-bit Intel or AMD processor. Pick one of two files:",
      options: [
        "<b>The .deb package</b>, for Ubuntu, Linux Mint and Debian. Open <code>klats_amd64.deb</code> in the software installer, or run <code>sudo apt install ./klats_amd64.deb</code> in a terminal. Klats appears in the app menu.",
        "<b>The AppImage</b>, for any of these systems, Fedora included, and it runs without installing. Allow <code>Klats-x86_64.AppImage</code> to run as a program (in its properties, or with <code>chmod +x Klats-x86_64.AppImage</code>) and run it.",
      ],
    },
    uninstall: {
      h: "How to uninstall Klats",
      list: [
        "<b>Windows.</b> Remove Klats in Settings → Apps, like any other program. At the end the uninstaller asks “Also delete my tests and results?” Answer “Yes”, and it deletes the data folder of the user who uninstalls, <code>%AppData%\\Klats</code>: all tests, classes, results and settings. “No” is the default: the data stays, and Klats finds it again if you reinstall. Backups saved in other folders are never deleted.",
        "<b>Mac.</b> Drag Klats from Applications to the Bin. The data stays in <code>~/Library/Application Support/Klats</code>; delete that folder if you no longer need it.",
        "<b>Linux.</b> Remove the package with <code>sudo apt remove klats</code>, and the AppImage like any file. The data stays in <code>~/.local/share/klats</code>.",
      ],
    },
    next: "Next: the first lesson",
  },
  firstLesson: {
    title: "First lesson",
    intro: "From installing to the first grades in ten steps.",
    steps: [
      {
        text: "Install Klats on your computer — see “How to install” for how.",
      },
      {
        text: "Connect the computer to the same network as the students’ PCs, and open Klats.",
      },
      {
        text: "In “Classes”, click “New class” and paste the list of students from Excel or the class register.",
      },
      {
        text: "In “My tests”, click “New test” and add questions — or click “Open” and pick a ready .klats or .mtf file.",
        shot: "builder",
      },
      {
        text: "Mark the right answers, and set the time and the grading scale in the test settings.",
      },
      { text: "Click “Start test” and pick the class." },
      {
        text: "Click “Show on the board”: the student address and the test code appear there.",
      },
      {
        text: "Students open the address in a browser, type the code and choose their name.",
        shot: "student",
      },
      {
        text: "Watch the class live: who answered what, who is offline, who needs more time.",
        shot: "live",
      },
      {
        text: "When everyone is done, click “End the test”, then “See the results”: the grades are there, ready to export to Excel.",
        shot: "results",
      },
    ],
  },
  faq: {
    title: "Questions and answers",
    connect: {
      h: "Students can’t connect",
      p: "Most often it is one of these:",
      list: [
        "<b>A different network.</b> Your computer and the students’ PCs must be on one network. Guest Wi-Fi often keeps devices from reaching each other, so join the same network as the class. If the computer is on several networks, pick the students’ one in Settings → Network.",
        "<b>The firewall.</b> On Windows, the installer lets the students’ PCs connect. If the school runs another firewall or antivirus, allow Klats in it. On a Mac, if macOS asks about incoming connections, click “Allow”. On Linux with a firewall turned on, open Klats’ port in it.",
        "<b>A busy port.</b> If another program already holds Klats’ port, a warning shows at the top of the window. Enter another number in Settings → Port and restart Klats.",
        "<b>A typo in the address.</b> Students must type the address exactly as on the board, with the number after the colon, if there is one.",
      ],
    },
    data: {
      h: "Where are tests and results kept?",
      p: "On your computer, in Klats’ data folder. Nothing goes to the internet.",
      list: [
        "Windows: <code>%AppData%\\Klats</code>",
        "macOS: <code>~/Library/Application Support/Klats</code>",
        "Linux: <code>~/.local/share/klats</code>, or <code>$XDG_DATA_HOME/klats</code> when <code>XDG_DATA_HOME</code> is set",
      ],
      backup:
        "To keep a copy of everything or move the data to another computer, use Settings → Backup.",
    },
    update: {
      h: "How do I update Klats?",
      p: "Download the new version and install it like the first: on Windows over the old one, on a Mac by replacing Klats in Applications, on Linux with the new .deb package or the new AppImage file. Your tests and results stay where they are.",
      link: "Download the new version",
    },
    check: {
      h: "How does Klats know about a new version?",
      paras: [
        "Once a day, Klats asks GitHub whether a new version is out. Nothing about you or the school is sent, and nothing is checked while a test runs.",
        "When a new version is out, “New version” shows at the top of the window, with a link to this site. Klats never updates itself.",
        "To stop the checks, turn off “Check for updates” in Settings → About.",
      ],
    },
  },
};

export const strings: Record<Lang, typeof uk> = { uk, en };

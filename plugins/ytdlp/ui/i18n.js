/* i18n for the yt-dlp (MeTube) plugin. */
(function () {
  'use strict';

  var S = {
    en: {
      desc:         'Runs MeTube — a yt-dlp web UI — in Docker on the remote, bound to loopback. Paste a video or playlist URL in the web UI; files download on the server (into ~/yt-dlp-downloads, merged to mp4).',
      setup_btn:    'Install & start MeTube',
      open_btn:     'Open MeTube',
      open_ext:     'Open in browser ↗',
      ready:        'Ready.',
      setup_msg:    'Setting up MeTube (approve the commands; the first image pull may take a minute)…',
      setup_failed: 'Setup failed — see the steps above (is Docker available?).',
      reachable_at: 'MeTube reachable at {0}',
      first_time:   'Open it, paste a video/playlist URL, pick quality, and download. Files land in ~/yt-dlp-downloads on the server.',
      rerun:        'Re-run setup',
      error:        'Error: {0}',
    },
    ar: {
      desc:         'يشغّل MeTube — واجهة ويب لـ yt-dlp — في Docker على الخادم البعيد. الصق رابط فيديو أو قائمة تشغيل في الواجهة؛ تُنزَّل الملفات على الخادم في ~/yt-dlp-downloads.',
      setup_btn:    'تثبيت MeTube وتشغيله',
      open_btn:     'فتح MeTube',
      open_ext:     'فتح في المتصفح ↗',
      ready:        'جاهز.',
      setup_msg:    'جارٍ إعداد MeTube (وافق على الأوامر؛ سحب الصورة الأولى قد يستغرق دقيقة)…',
      setup_failed: 'فشل الإعداد — راجع الخطوات أعلاه (هل Docker متاح؟).',
      reachable_at: 'MeTube متاح على {0}',
      first_time:   'افتحه، الصق رابط فيديو أو قائمة، اختر الجودة، وحمّل. تُحفظ الملفات في ~/yt-dlp-downloads على الخادم.',
      rerun:        'إعادة الإعداد',
      error:        'خطأ: {0}',
    },
    bn: {
      desc:         'রিমোটে Docker-এ MeTube — yt-dlp ওয়েব UI — চালায়। ওয়েব UI-তে ভিডিও বা প্লেলিস্ট URL পেস্ট করুন; ফাইলগুলি সার্ভারে ~/yt-dlp-downloads-এ ডাউনলোড হয়।',
      setup_btn:    'MeTube ইনস্টল ও চালু করুন',
      open_btn:     'MeTube খুলুন',
      open_ext:     'ব্রাউজারে খুলুন ↗',
      ready:        'প্রস্তুত।',
      setup_msg:    'MeTube সেটআপ হচ্ছে (কমান্ড অনুমোদন করুন; প্রথম image pull কয়েক মিনিট লাগতে পারে)…',
      setup_failed: 'সেটআপ ব্যর্থ — উপরের ধাপগুলি দেখুন (Docker পাওয়া যাচ্ছে কি?)।',
      reachable_at: '{0}-এ MeTube পাওয়া যাচ্ছে',
      first_time:   'এটি খুলুন, ভিডিও/প্লেলিস্ট URL পেস্ট করুন, মান বেছে নিন এবং ডাউনলোড করুন। ফাইলগুলি সার্ভারে ~/yt-dlp-downloads-এ যায়।',
      rerun:        'পুনরায় সেটআপ করুন',
      error:        'ত্রুটি: {0}',
    },
    de: {
      desc:         'Führt MeTube — eine yt-dlp-Weboberfläche — in Docker auf dem Remote-Server aus. Video- oder Playlist-URL in die Web-UI einfügen; Dateien laden auf dem Server in ~/yt-dlp-downloads herunter.',
      setup_btn:    'MeTube installieren & starten',
      open_btn:     'MeTube öffnen',
      open_ext:     'Im Browser öffnen ↗',
      ready:        'Bereit.',
      setup_msg:    'MeTube wird eingerichtet (Befehle bestätigen; erster Image-Pull kann eine Minute dauern)…',
      setup_failed: 'Einrichtung fehlgeschlagen — Schritte oben prüfen (Docker verfügbar?).',
      reachable_at: 'MeTube erreichbar unter {0}',
      first_time:   'Öffnen, Video-/Playlist-URL einfügen, Qualität wählen und herunterladen. Dateien landen in ~/yt-dlp-downloads auf dem Server.',
      rerun:        'Setup erneut ausführen',
      error:        'Fehler: {0}',
    },
    es: {
      desc:         'Ejecuta MeTube — una interfaz web para yt-dlp — en Docker en el servidor remoto. Pega una URL de vídeo o lista de reproducción en la web UI; los archivos se descargan en el servidor en ~/yt-dlp-downloads.',
      setup_btn:    'Instalar & iniciar MeTube',
      open_btn:     'Abrir MeTube',
      open_ext:     'Abrir en el navegador ↗',
      ready:        'Listo.',
      setup_msg:    'Configurando MeTube (aprueba los comandos; la primera imagen puede tardar un minuto)…',
      setup_failed: 'Error en la configuración — ver los pasos anteriores (¿está disponible Docker?).',
      reachable_at: 'MeTube disponible en {0}',
      first_time:   'Ábrelo, pega una URL de vídeo/lista, elige la calidad y descarga. Los archivos quedan en ~/yt-dlp-downloads en el servidor.',
      rerun:        'Volver a configurar',
      error:        'Error: {0}',
    },
    fr: {
      desc:         'Lance MeTube — une interface web pour yt-dlp — dans Docker sur le serveur distant. Colle une URL de vidéo ou de playlist dans l'interface ; les fichiers se téléchargent sur le serveur dans ~/yt-dlp-downloads.',
      setup_btn:    'Installer & démarrer MeTube',
      open_btn:     'Ouvrir MeTube',
      open_ext:     'Ouvrir dans le navigateur ↗',
      ready:        'Prêt.',
      setup_msg:    'Configuration de MeTube (approuver les commandes ; le premier pull d'image peut prendre une minute)…',
      setup_failed: 'Échec de la configuration — voir les étapes ci-dessus (Docker disponible ?).',
      reachable_at: 'MeTube accessible à {0}',
      first_time:   'Ouvre-le, colle une URL vidéo/playlist, choisis la qualité et télécharge. Les fichiers atterrissent dans ~/yt-dlp-downloads sur le serveur.',
      rerun:        'Relancer la configuration',
      error:        'Erreur : {0}',
    },
    hi: {
      desc:         'रिमोट पर Docker में MeTube — yt-dlp वेब UI — चलाता है। वेब UI में वीडियो या प्लेलिस्ट URL पेस्ट करें; फ़ाइलें सर्वर पर ~/yt-dlp-downloads में डाउनलोड होती हैं।',
      setup_btn:    'MeTube इंस्टॉल करें और शुरू करें',
      open_btn:     'MeTube खोलें',
      open_ext:     'ब्राउज़र में खोलें ↗',
      ready:        'तैयार।',
      setup_msg:    'MeTube सेटअप हो रहा है (कमांड स्वीकृत करें; पहला image pull में एक मिनट लग सकता है)…',
      setup_failed: 'सेटअप विफल — ऊपर के चरण देखें (क्या Docker उपलब्ध है?)।',
      reachable_at: 'MeTube {0} पर उपलब्ध',
      first_time:   'इसे खोलें, वीडियो/प्लेलिस्ट URL पेस्ट करें, गुणवत्ता चुनें और डाउनलोड करें। फ़ाइलें सर्वर पर ~/yt-dlp-downloads में जाती हैं।',
      rerun:        'सेटअप फिर से चलाएं',
      error:        'त्रुटि: {0}',
    },
    id: {
      desc:         'Menjalankan MeTube — antarmuka web yt-dlp — di Docker pada host jarak jauh. Tempel URL video atau playlist di web UI; file diunduh di server ke ~/yt-dlp-downloads.',
      setup_btn:    'Pasang & jalankan MeTube',
      open_btn:     'Buka MeTube',
      open_ext:     'Buka di browser ↗',
      ready:        'Siap.',
      setup_msg:    'Menyiapkan MeTube (setujui perintah; pull image pertama mungkin butuh satu menit)…',
      setup_failed: 'Setup gagal — lihat langkah di atas (apakah Docker tersedia?).',
      reachable_at: 'MeTube tersedia di {0}',
      first_time:   'Buka, tempel URL video/playlist, pilih kualitas, dan unduh. File disimpan di ~/yt-dlp-downloads di server.',
      rerun:        'Jalankan ulang pengaturan',
      error:        'Kesalahan: {0}',
    },
    ja: {
      desc:         'リモートのDockerでMeTube（yt-dlpウェブUI）を起動します。ウェブUIで動画やプレイリストURLを貼り付けると、サーバーの~/yt-dlp-downloadsにダウンロードされます。',
      setup_btn:    'MeTube をインストール・起動',
      open_btn:     'MeTube を開く',
      open_ext:     'ブラウザで開く ↗',
      ready:        '準備完了。',
      setup_msg:    'MeTubeをセットアップ中（コマンドを承認してください；初回イメージ取得に1分かかる場合があります）…',
      setup_failed: 'セットアップ失敗 — 上のステップを確認してください（Dockerは利用可能ですか？）。',
      reachable_at: 'MeTube は {0} で利用できます',
      first_time:   '開いて動画/プレイリストURLを貼り付け、品質を選んでダウンロード。ファイルはサーバーの~/yt-dlp-downloadsに保存されます。',
      rerun:        'セットアップを再実行',
      error:        'エラー: {0}',
    },
    mr: {
      desc:         'रिमोटवर Docker मध्ये MeTube — yt-dlp वेब UI — चालवतो. वेब UI मध्ये व्हिडिओ किंवा प्लेलिस्ट URL पेस्ट करा; फाइल्स सर्व्हरवर ~/yt-dlp-downloads मध्ये डाउनलोड होतात.',
      setup_btn:    'MeTube इन्स्टॉल करा आणि सुरू करा',
      open_btn:     'MeTube उघडा',
      open_ext:     'ब्राउझरमध्ये उघडा ↗',
      ready:        'तयार.',
      setup_msg:    'MeTube सेट होत आहे (आदेश मंजूर करा; पहिला image pull एक मिनिट घेऊ शकतो)…',
      setup_failed: 'सेटअप अयशस्वी — वरील पायऱ्या पहा (Docker उपलब्ध आहे का?).',
      reachable_at: 'MeTube {0} वर उपलब्ध',
      first_time:   'उघडा, व्हिडिओ/प्लेलिस्ट URL पेस्ट करा, गुणवत्ता निवडा आणि डाउनलोड करा. फाइल्स सर्व्हरवर ~/yt-dlp-downloads मध्ये जातात.',
      rerun:        'पुन्हा सेटअप करा',
      error:        'त्रुटी: {0}',
    },
    pcm: {
      desc:         'E go run MeTube — yt-dlp web app — for Docker on top of remote host. Paste video or playlist URL inside the web app; files go download on server to ~/yt-dlp-downloads.',
      setup_btn:    'Install & start MeTube',
      open_btn:     'Open MeTube',
      open_ext:     'Open for browser ↗',
      ready:        'E don ready.',
      setup_msg:    'E dey set up MeTube (approve the commands; first image pull fit take one minute)…',
      setup_failed: 'Setup fail — check the steps wey dey above (Docker available?).',
      reachable_at: 'MeTube dey for {0}',
      first_time:   'Open am, paste video/playlist URL, pick quality, then download. Files go land for ~/yt-dlp-downloads on the server.',
      rerun:        'Run setup again',
      error:        'Error: {0}',
    },
    pt: {
      desc:         'Executa o MeTube — uma interface web para yt-dlp — no Docker no host remoto. Cole uma URL de vídeo ou playlist na web UI; os arquivos são baixados no servidor em ~/yt-dlp-downloads.',
      setup_btn:    'Instalar & iniciar MeTube',
      open_btn:     'Abrir MeTube',
      open_ext:     'Abrir no navegador ↗',
      ready:        'Pronto.',
      setup_msg:    'Configurando MeTube (aprove os comandos; o primeiro pull de imagem pode demorar um minuto)…',
      setup_failed: 'Falha na configuração — ver passos acima (Docker disponível?).',
      reachable_at: 'MeTube disponível em {0}',
      first_time:   'Abra, cole uma URL de vídeo/playlist, escolha a qualidade e baixe. Os arquivos ficam em ~/yt-dlp-downloads no servidor.',
      rerun:        'Executar configuração novamente',
      error:        'Erro: {0}',
    },
    ru: {
      desc:         'Запускает MeTube — веб-интерфейс для yt-dlp — в Docker на удалённом хосте. Вставьте URL видео или плейлиста в веб-интерфейс; файлы загружаются на сервер в ~/yt-dlp-downloads.',
      setup_btn:    'Установить и запустить MeTube',
      open_btn:     'Открыть MeTube',
      open_ext:     'Открыть в браузере ↗',
      ready:        'Готово.',
      setup_msg:    'Настройка MeTube (подтвердите команды; первый pull образа может занять минуту)…',
      setup_failed: 'Ошибка настройки — см. шаги выше (Docker доступен?).',
      reachable_at: 'MeTube доступен по адресу {0}',
      first_time:   'Откройте, вставьте URL видео/плейлиста, выберите качество и скачайте. Файлы сохраняются в ~/yt-dlp-downloads на сервере.',
      rerun:        'Повторить настройку',
      error:        'Ошибка: {0}',
    },
    ta: {
      desc:         'தொலைதூர ஹோஸ்டில் Docker-ல் MeTube — yt-dlp வலை UI — இயக்குகிறது. வலை UI-ல் வீடியோ அல்லது பிளேலிஸ்ட் URL ஒட்டவும்; கோப்புகள் சர்வரில் ~/yt-dlp-downloads-ல் பதிவிறக்கப்படும்.',
      setup_btn:    'MeTube நிறுவி தொடங்கு',
      open_btn:     'MeTube திற',
      open_ext:     'உலாவியில் திற ↗',
      ready:        'தயார்.',
      setup_msg:    'MeTube அமைக்கிறது (கட்டளைகளை அங்கீகரிக்கவும்; முதல் image pull ஒரு நிமிடம் ஆகலாம்)…',
      setup_failed: 'அமைவு தோல்வியடைந்தது — மேலே உள்ள படிகளைப் பாருங்கள் (Docker கிடைக்கிறதா?).',
      reachable_at: 'MeTube {0}-ல் கிடைக்கிறது',
      first_time:   'திறந்து, வீடியோ/பிளேலிஸ்ட் URL ஒட்டவும், தரம் தேர்ந்தெடுக்கவும், பதிவிறக்கவும். கோப்புகள் சர்வரில் ~/yt-dlp-downloads-ல் சேரும்.',
      rerun:        'அமைப்பை மீண்டும் இயக்கு',
      error:        'பிழை: {0}',
    },
    te: {
      desc:         'రిమోట్ హోస్ట్‌లో Docker-లో MeTube — yt-dlp వెబ్ UI — నడుపుతుంది. వెబ్ UI-లో వీడియో లేదా ప్లేలిస్ట్ URL అతికించండి; ఫైళ్లు సర్వర్‌లో ~/yt-dlp-downloads-కి డౌన్‌లోడ్ అవుతాయి.',
      setup_btn:    'MeTube ఇన్‌స్టాల్ చేసి ప్రారంభించు',
      open_btn:     'MeTube తెరువు',
      open_ext:     'బ్రౌజర్‌లో తెరువు ↗',
      ready:        'సిద్ధంగా ఉంది.',
      setup_msg:    'MeTube సెటప్ అవుతోంది (ఆదేశాలను ఆమోదించండి; మొదటి image pull ఒక నిమిషం పట్టవచ్చు)…',
      setup_failed: 'సెటప్ విఫలమైంది — పైన ఉన్న దశలు చూడండి (Docker అందుబాటులో ఉందా?).',
      reachable_at: 'MeTube {0} వద్ద అందుబాటులో ఉంది',
      first_time:   'తెరవండి, వీడియో/ప్లేలిస్ట్ URL అతికించండి, నాణ్యత ఎంచుకోండి, డౌన్‌లోడ్ చేయండి. ఫైళ్లు సర్వర్‌లో ~/yt-dlp-downloads-కి వెళ్తాయి.',
      rerun:        'సెటప్ తిరిగి అమలు చేయి',
      error:        'లోపం: {0}',
    },
    tr: {
      desc:         'Uzak sunucuda Docker\'da MeTube — yt-dlp web arayüzü — çalıştırır. Web arayüzüne video veya playlist URL yapıştırın; dosyalar sunucuda ~/yt-dlp-downloads dizinine indirilir.',
      setup_btn:    'MeTube kur & başlat',
      open_btn:     'MeTube aç',
      open_ext:     'Tarayıcıda aç ↗',
      ready:        'Hazır.',
      setup_msg:    'MeTube kuruluyor (komutları onaylayın; ilk image pull bir dakika sürebilir)…',
      setup_failed: 'Kurulum başarısız — yukarıdaki adımlara bakın (Docker mevcut mu?).',
      reachable_at: 'MeTube {0} adresinde erişilebilir',
      first_time:   'Açın, video/playlist URL yapıştırın, kalite seçin ve indirin. Dosyalar sunucuda ~/yt-dlp-downloads klasörüne kaydedilir.',
      rerun:        'Kurulumu yeniden çalıştır',
      error:        'Hata: {0}',
    },
    ur: {
      desc:         'ریموٹ ہوسٹ پر Docker میں MeTube — yt-dlp ویب UI — چلاتا ہے۔ ویب UI میں ویڈیو یا پلے لسٹ URL چسپاں کریں؛ فائلیں سرور پر ~/yt-dlp-downloads میں ڈاؤن لوڈ ہوتی ہیں۔',
      setup_btn:    'MeTube انسٹال کریں اور شروع کریں',
      open_btn:     'MeTube کھولیں',
      open_ext:     'براؤزر میں کھولیں ↗',
      ready:        'تیار۔',
      setup_msg:    'MeTube سیٹ اپ ہو رہا ہے (کمانڈز منظور کریں؛ پہلا image pull ایک منٹ لے سکتا ہے)…',
      setup_failed: 'سیٹ اپ ناکام — اوپر کے مراحل دیکھیں (کیا Docker دستیاب ہے؟)۔',
      reachable_at: 'MeTube {0} پر دستیاب ہے',
      first_time:   'کھولیں، ویڈیو/پلے لسٹ URL چسپاں کریں، معیار منتخب کریں اور ڈاؤن لوڈ کریں۔ فائلیں سرور پر ~/yt-dlp-downloads میں جاتی ہیں۔',
      rerun:        'سیٹ اپ دوبارہ چلائیں',
      error:        'خرابی: {0}',
    },
    'zh-CN': {
      desc:         '在远程主机的 Docker 中运行 MeTube（yt-dlp 网页界面）。在网页界面粘贴视频或播放列表 URL；文件下载到服务器的 ~/yt-dlp-downloads 目录。',
      setup_btn:    '安装并启动 MeTube',
      open_btn:     '打开 MeTube',
      open_ext:     '在浏览器中打开 ↗',
      ready:        '就绪。',
      setup_msg:    '正在安装 MeTube（请批准命令；首次拉取镜像可能需要一分钟）…',
      setup_failed: '安装失败 — 请查看上方步骤（Docker 可用吗？）。',
      reachable_at: 'MeTube 可在 {0} 访问',
      first_time:   '打开它，粘贴视频/播放列表 URL，选择质量并下载。文件保存在服务器的 ~/yt-dlp-downloads 目录。',
      rerun:        '重新安装',
      error:        '错误：{0}',
    },
    'zh-HK': {
      desc:         '在遠端主機的 Docker 中運行 MeTube（yt-dlp 網頁介面）。在網頁介面貼上影片或播放清單 URL；檔案下載到伺服器的 ~/yt-dlp-downloads 目錄。',
      setup_btn:    '安裝並啟動 MeTube',
      open_btn:     '開啟 MeTube',
      open_ext:     '在瀏覽器中開啟 ↗',
      ready:        '就緒。',
      setup_msg:    '正在安裝 MeTube（請批准指令；首次拉取映像可能需要一分鐘）…',
      setup_failed: '安裝失敗 — 請查看上方步驟（Docker 可用嗎？）。',
      reachable_at: 'MeTube 可在 {0} 存取',
      first_time:   '開啟它，貼上影片/播放清單 URL，選擇品質並下載。檔案儲存在伺服器的 ~/yt-dlp-downloads 目錄。',
      rerun:        '重新安裝',
      error:        '錯誤：{0}',
    },
  };
  S['ar-EG'] = S['ar'];

  var MAP = { 'in': 'id', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN', 'zh-tw': 'zh-HK', 'zh-hant': 'zh-HK' };

  function resolve() {
    var nav = (navigator.language || 'en').toLowerCase();
    var mapped = MAP[nav] || nav;
    if (S[mapped]) return mapped;
    var upper = nav.replace(/-([a-z]{2})$/, function (_, r) { return '-' + r.toUpperCase(); });
    if (S[upper]) return upper;
    var base = nav.split('-')[0];
    if (S[base]) return base;
    return 'en';
  }

  var locale = resolve();
  var dict = S[locale];

  window.t = function (key) {
    var s = (dict && dict[key] !== undefined) ? dict[key] : (S.en[key] !== undefined ? S.en[key] : key);
    for (var i = 1; i < arguments.length; i++) {
      s = s.replace('{' + (i - 1) + '}', arguments[i]);
    }
    return s;
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    if (locale === 'ar' || locale === 'ar-EG' || locale === 'ur') {
      document.documentElement.setAttribute('dir', 'rtl');
    }
  });
})();

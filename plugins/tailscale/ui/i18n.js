/* i18n for the Tailscale plugin. */
(function () {
  'use strict';

  var S = {
    en: {
      desc:              'Joins this server to your tailnet. Once connected, other plugins can be reached over real HTTPS at host.tailnet.ts.net (the tailscale-serve tunnel backend) — no port-forward needed.',
      setup_btn:         'Install & connect',
      login_btn:         'Open login URL',
      refresh_btn:       'Refresh status',
      ready:             'Ready.',
      setup_msg:         'Installing + connecting Tailscale (approve the commands when asked)…',
      setup_failed:      'Setup failed — see output above.',
      login_required:    'Login required. Tap "Open login URL" and authorize this server.',
      already_connected: 'Server is already connected to your tailnet.',
      rerun:             'Re-run setup',
      error:             'Error: {0}',
    },
    ar: {
      desc:              'يضم هذا الخادم إلى شبكتك tailnet. بعد الاتصال، يمكن الوصول إلى الإضافات الأخرى عبر HTTPS حقيقي على host.tailnet.ts.net دون الحاجة إلى تمرير منافذ.',
      setup_btn:         'تثبيت والاتصال',
      login_btn:         'فتح رابط تسجيل الدخول',
      refresh_btn:       'تحديث الحالة',
      ready:             'جاهز.',
      setup_msg:         'جارٍ تثبيت Tailscale والاتصال (وافق على الأوامر عند الطلب)…',
      setup_failed:      'فشل الإعداد — راجع المخرجات أعلاه.',
      login_required:    'مطلوب تسجيل الدخول. اضغط على "فتح رابط تسجيل الدخول" وفوّض هذا الخادم.',
      already_connected: 'الخادم متصل بالفعل بشبكتك tailnet.',
      rerun:             'إعادة الإعداد',
      error:             'خطأ: {0}',
    },
    bn: {
      desc:              'এই সার্ভারটিকে আপনার tailnet-এ যোগ করে। সংযুক্ত হলে অন্য প্লাগইনগুলি host.tailnet.ts.net-এ HTTPS-এ পাওয়া যাবে — পোর্ট ফরওয়ার্ডিং লাগবে না।',
      setup_btn:         'ইনস্টল করুন ও সংযুক্ত হন',
      login_btn:         'লগইন URL খুলুন',
      refresh_btn:       'স্ট্যাটাস রিফ্রেশ করুন',
      ready:             'প্রস্তুত।',
      setup_msg:         'Tailscale ইনস্টল ও সংযুক্ত হচ্ছে (অনুরোধ করলে কমান্ড অনুমোদন করুন)…',
      setup_failed:      'সেটআপ ব্যর্থ — উপরের আউটপুট দেখুন।',
      login_required:    'লগইন প্রয়োজন। "লগইন URL খুলুন" চাপুন এবং এই সার্ভার অনুমোদন করুন।',
      already_connected: 'সার্ভার ইতিমধ্যে আপনার tailnet-এ সংযুক্ত।',
      rerun:             'পুনরায় সেটআপ করুন',
      error:             'ত্রুটি: {0}',
    },
    de: {
      desc:              'Verbindet diesen Server mit deinem Tailnet. Andere Plugins sind danach über echtes HTTPS unter host.tailnet.ts.net erreichbar — kein Port-Forward nötig.',
      setup_btn:         'Installieren & verbinden',
      login_btn:         'Login-URL öffnen',
      refresh_btn:       'Status aktualisieren',
      ready:             'Bereit.',
      setup_msg:         'Tailscale wird installiert und verbunden (Befehle bei Aufforderung bestätigen)…',
      setup_failed:      'Einrichtung fehlgeschlagen — Ausgabe oben prüfen.',
      login_required:    'Login erforderlich. „Login-URL öffnen" tippen und den Server autorisieren.',
      already_connected: 'Der Server ist bereits mit deinem Tailnet verbunden.',
      rerun:             'Setup erneut ausführen',
      error:             'Fehler: {0}',
    },
    es: {
      desc:              'Une este servidor a tu tailnet. Una vez conectado, otros plugins son accesibles por HTTPS real en host.tailnet.ts.net — sin reenvío de puertos.',
      setup_btn:         'Instalar & conectar',
      login_btn:         'Abrir URL de inicio de sesión',
      refresh_btn:       'Actualizar estado',
      ready:             'Listo.',
      setup_msg:         'Instalando + conectando Tailscale (aprueba los comandos cuando se solicite)…',
      setup_failed:      'Error en la configuración — ver la salida arriba.',
      login_required:    'Inicio de sesión requerido. Pulsa "Abrir URL de inicio de sesión" y autoriza el servidor.',
      already_connected: 'El servidor ya está conectado a tu tailnet.',
      rerun:             'Volver a configurar',
      error:             'Error: {0}',
    },
    fr: {
      desc:              'Rejoint ce serveur à ton tailnet. Une fois connecté, les autres plugins sont accessibles via HTTPS réel à host.tailnet.ts.net — aucun transfert de port nécessaire.',
      setup_btn:         'Installer & connecter',
      login_btn:         'Ouvrir l\'URL de connexion',
      refresh_btn:       'Actualiser le statut',
      ready:             'Prêt.',
      setup_msg:         'Installation + connexion de Tailscale (approuver les commandes si demandé)…',
      setup_failed:      'Échec de la configuration — voir la sortie ci-dessus.',
      login_required:    'Connexion requise. Tapez « Ouvrir l\'URL de connexion » et autorisez ce serveur.',
      already_connected: 'Le serveur est déjà connecté à votre tailnet.',
      rerun:             'Relancer la configuration',
      error:             'Erreur : {0}',
    },
    hi: {
      desc:              'इस सर्वर को आपके tailnet से जोड़ता है। एक बार कनेक्ट होने पर, अन्य प्लगइन host.tailnet.ts.net पर HTTPS के माध्यम से पहुँचे जा सकते हैं — पोर्ट फॉर्वर्डिंग की ज़रूरत नहीं।',
      setup_btn:         'इंस्टॉल करें और कनेक्ट करें',
      login_btn:         'लॉगिन URL खोलें',
      refresh_btn:       'स्थिति ताज़ा करें',
      ready:             'तैयार।',
      setup_msg:         'Tailscale इंस्टॉल और कनेक्ट हो रहा है (पूछे जाने पर कमांड स्वीकृत करें)…',
      setup_failed:      'सेटअप विफल — ऊपर का आउटपुट देखें।',
      login_required:    'लॉगिन आवश्यक है। "लॉगिन URL खोलें" दबाएं और इस सर्वर को अधिकृत करें।',
      already_connected: 'सर्वर पहले से आपके tailnet से जुड़ा है।',
      rerun:             'सेटअप फिर से चलाएं',
      error:             'त्रुटि: {0}',
    },
    id: {
      desc:              'Menghubungkan server ini ke tailnet Anda. Setelah terhubung, plugin lain dapat diakses melalui HTTPS nyata di host.tailnet.ts.net — tidak perlu port-forward.',
      setup_btn:         'Pasang & hubungkan',
      login_btn:         'Buka URL login',
      refresh_btn:       'Perbarui status',
      ready:             'Siap.',
      setup_msg:         'Memasang + menghubungkan Tailscale (setujui perintah saat diminta)…',
      setup_failed:      'Penyiapan gagal — lihat keluaran di atas.',
      login_required:    'Login diperlukan. Ketuk "Buka URL login" dan otorisasi server ini.',
      already_connected: 'Server sudah terhubung ke tailnet Anda.',
      rerun:             'Jalankan ulang pengaturan',
      error:             'Kesalahan: {0}',
    },
    ja: {
      desc:              'このサーバーをtailnetに参加させます。接続後、他のプラグインはhost.tailnet.ts.netの本物のHTTPSでアクセス可能になります（ポートフォワード不要）。',
      setup_btn:         'インストール・接続',
      login_btn:         'ログインURLを開く',
      refresh_btn:       'ステータス更新',
      ready:             '準備完了。',
      setup_msg:         'Tailscaleをインストール・接続中（コマンドの承認を求められたら承認してください）…',
      setup_failed:      'セットアップ失敗 — 上の出力を確認してください。',
      login_required:    'ログインが必要です。「ログインURLを開く」をタップしてこのサーバーを認証してください。',
      already_connected: 'サーバーはすでにtailnetに接続されています。',
      rerun:             'セットアップを再実行',
      error:             'エラー: {0}',
    },
    mr: {
      desc:              'हा सर्व्हर तुमच्या tailnet मध्ये सामील करतो. कनेक्ट झाल्यावर, इतर प्लगइन host.tailnet.ts.net वर खऱ्या HTTPS द्वारे उपलब्ध होतात — पोर्ट-फॉर्वर्डची गरज नाही.',
      setup_btn:         'इन्स्टॉल करा आणि कनेक्ट करा',
      login_btn:         'लॉगिन URL उघडा',
      refresh_btn:       'स्थिती रिफ्रेश करा',
      ready:             'तयार.',
      setup_msg:         'Tailscale इन्स्टॉल होत आहे आणि कनेक्ट होत आहे (विचारल्यावर आदेश मंजूर करा)…',
      setup_failed:      'सेटअप अयशस्वी — वरील आउटपुट पहा.',
      login_required:    'लॉगिन आवश्यक आहे. "लॉगिन URL उघडा" दाबा आणि हा सर्व्हर अधिकृत करा.',
      already_connected: 'सर्व्हर आधीच तुमच्या tailnet शी जोडलेला आहे.',
      rerun:             'पुन्हा सेटअप करा',
      error:             'त्रुटी: {0}',
    },
    pcm: {
      desc:              'E go add dis server to your tailnet. After e connect, other plugins go dey available for HTTPS for host.tailnet.ts.net — no port-forward needed.',
      setup_btn:         'Install & connect',
      login_btn:         'Open login URL',
      refresh_btn:       'Refresh status',
      ready:             'E don ready.',
      setup_msg:         'E dey install + connect Tailscale (approve the commands when dem ask)…',
      setup_failed:      'Setup fail — check output wey dey above.',
      login_required:    'You need to login. Tap "Open login URL" make you authorize dis server.',
      already_connected: 'Server don already connect to your tailnet.',
      rerun:             'Run setup again',
      error:             'Error: {0}',
    },
    pt: {
      desc:              'Une este servidor à sua tailnet. Depois de conectado, outros plugins podem ser acessados via HTTPS real em host.tailnet.ts.net — sem necessidade de encaminhar portas.',
      setup_btn:         'Instalar & conectar',
      login_btn:         'Abrir URL de login',
      refresh_btn:       'Atualizar status',
      ready:             'Pronto.',
      setup_msg:         'Instalando + conectando o Tailscale (aprove os comandos quando solicitado)…',
      setup_failed:      'Falha na configuração — veja a saída acima.',
      login_required:    'Login necessário. Toque em "Abrir URL de login" e autorize este servidor.',
      already_connected: 'O servidor já está conectado à sua tailnet.',
      rerun:             'Executar configuração novamente',
      error:             'Erro: {0}',
    },
    ru: {
      desc:              'Подключает этот сервер к вашей tailnet. После подключения другие плагины доступны по настоящему HTTPS на host.tailnet.ts.net — без проброса портов.',
      setup_btn:         'Установить и подключить',
      login_btn:         'Открыть ссылку для входа',
      refresh_btn:       'Обновить статус',
      ready:             'Готово.',
      setup_msg:         'Установка и подключение Tailscale (подтверждайте команды по запросу)…',
      setup_failed:      'Ошибка настройки — см. вывод выше.',
      login_required:    'Требуется вход. Нажмите «Открыть ссылку для входа» и авторизуйте сервер.',
      already_connected: 'Сервер уже подключён к вашей tailnet.',
      rerun:             'Повторить настройку',
      error:             'Ошибка: {0}',
    },
    ta: {
      desc:              'இந்த சர்வரை உங்கள் tailnet-ல் இணைக்கிறது. இணைந்தவுடன், மற்ற செருகுநிரல்கள் host.tailnet.ts.net-ல் HTTPS வழியாக அணுகலாம் — போர்ட்-ஃபாரவர்ட் தேவையில்லை.',
      setup_btn:         'நிறுவி இணை',
      login_btn:         'உள்நுழைவு URL திற',
      refresh_btn:       'நிலையை புதுப்பி',
      ready:             'தயார்.',
      setup_msg:         'Tailscale நிறுவி இணைக்கிறது (கட்டளைகளை அங்கீகரிக்கவும்)…',
      setup_failed:      'அமைவு தோல்வியடைந்தது — மேலே உள்ள வெளியீடைப் பாருங்கள்.',
      login_required:    'உள்நுழைவு தேவை. "உள்நுழைவு URL திற" தட்டி இந்த சர்வரை அங்கீகரிக்கவும்.',
      already_connected: 'சர்வர் ஏற்கனவே உங்கள் tailnet-ல் இணைந்துள்ளது.',
      rerun:             'அமைப்பை மீண்டும் இயக்கு',
      error:             'பிழை: {0}',
    },
    te: {
      desc:              'ఈ సర్వర్‌ని మీ tailnet-కి చేరుస్తుంది. కనెక్ట్ అయిన తర్వాత, ఇతర ప్లగిన్‌లు host.tailnet.ts.net-లో HTTPS ద్వారా అందుబాటులో ఉంటాయి — పోర్ట్-ఫార్వర్డ్ అవసరం లేదు.',
      setup_btn:         'ఇన్‌స్టాల్ చేసి కనెక్ట్ చేయి',
      login_btn:         'లాగిన్ URL తెరువు',
      refresh_btn:       'స్టేటస్ రిఫ్రెష్ చేయి',
      ready:             'సిద్ధంగా ఉంది.',
      setup_msg:         'Tailscale ఇన్‌స్టాల్ అవుతూ కనెక్ట్ అవుతోంది (అడిగినప్పుడు ఆదేశాలను ఆమోదించండి)…',
      setup_failed:      'సెటప్ విఫలమైంది — పైన ఉన్న అవుట్‌పుట్ చూడండి.',
      login_required:    'లాగిన్ అవసరం. "లాగిన్ URL తెరువు" నొక్కి ఈ సర్వర్‌ని అధికారపరచండి.',
      already_connected: 'సర్వర్ ఇప్పటికే మీ tailnet-కి కనెక్ట్ అయి ఉంది.',
      rerun:             'సెటప్ తిరిగి అమలు చేయి',
      error:             'లోపం: {0}',
    },
    tr: {
      desc:              'Bu sunucuyu tailnet\'inize bağlar. Bağlandıktan sonra diğer eklentiler host.tailnet.ts.net üzerinden gerçek HTTPS ile erişilebilir — port yönlendirmeye gerek yok.',
      setup_btn:         'Kur & bağlan',
      login_btn:         'Giriş URL\'sini aç',
      refresh_btn:       'Durumu yenile',
      ready:             'Hazır.',
      setup_msg:         'Tailscale kuruluyor + bağlanıyor (istenildiğinde komutları onaylayın)…',
      setup_failed:      'Kurulum başarısız — yukarıdaki çıktıya bakın.',
      login_required:    'Giriş gerekli. "Giriş URL\'sini aç" öğesine dokunun ve bu sunucuyu yetkilendirin.',
      already_connected: 'Sunucu zaten tailnet\'inize bağlı.',
      rerun:             'Kurulumu yeniden çalıştır',
      error:             'Hata: {0}',
    },
    ur: {
      desc:              'اس سرور کو آپ کے tailnet سے جوڑتا ہے۔ کنیکٹ ہونے کے بعد دیگر پلگ ان host.tailnet.ts.net پر HTTPS کے ذریعے دستیاب ہوں گے — پورٹ فارورڈنگ کی ضرورت نہیں۔',
      setup_btn:         'انسٹال کریں اور کنیکٹ کریں',
      login_btn:         'لاگ ان URL کھولیں',
      refresh_btn:       'اسٹیٹس ریفریش کریں',
      ready:             'تیار۔',
      setup_msg:         'Tailscale انسٹال اور کنیکٹ ہو رہا ہے (مانگنے پر کمانڈز منظور کریں)…',
      setup_failed:      'سیٹ اپ ناکام — اوپر کا آؤٹ پٹ دیکھیں۔',
      login_required:    'لاگ ان ضروری ہے۔ "لاگ ان URL کھولیں" پر ٹیپ کریں اور اس سرور کو اجازت دیں۔',
      already_connected: 'سرور پہلے سے آپ کے tailnet سے جڑا ہوا ہے۔',
      rerun:             'سیٹ اپ دوبارہ چلائیں',
      error:             'خرابی: {0}',
    },
    'zh-CN': {
      desc:              '将此服务器加入您的 tailnet。连接后，其他插件可通过 host.tailnet.ts.net 上的真实 HTTPS 访问，无需端口转发。',
      setup_btn:         '安装并连接',
      login_btn:         '打开登录链接',
      refresh_btn:       '刷新状态',
      ready:             '就绪。',
      setup_msg:         '正在安装并连接 Tailscale（被询问时请批准命令）…',
      setup_failed:      '安装失败 — 请查看上方输出。',
      login_required:    '需要登录。点击「打开登录链接」并授权此服务器。',
      already_connected: '服务器已连接到您的 tailnet。',
      rerun:             '重新安装',
      error:             '错误：{0}',
    },
    'zh-HK': {
      desc:              '將此伺服器加入您的 tailnet。連接後，其他插件可透過 host.tailnet.ts.net 上的真實 HTTPS 存取，無需連接埠轉發。',
      setup_btn:         '安裝並連接',
      login_btn:         '開啟登入連結',
      refresh_btn:       '重新整理狀態',
      ready:             '就緒。',
      setup_msg:         '正在安裝並連接 Tailscale（被詢問時請批准指令）…',
      setup_failed:      '安裝失敗 — 請查看上方輸出。',
      login_required:    '需要登入。點選「開啟登入連結」並授權此伺服器。',
      already_connected: '伺服器已連接到您的 tailnet。',
      rerun:             '重新安裝',
      error:             '錯誤：{0}',
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

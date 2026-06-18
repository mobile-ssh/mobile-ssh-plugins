/* i18n for the WireGuard plugin. */
(function () {
  'use strict';

  var S = {
    en: {
      desc:         'Runs wg-easy in Docker on the remote. After setup, open the admin UI to finish the first-run wizard, then add clients and scan their QR codes.',
      setup_btn:    'Install & start wg-easy',
      open_admin:   'Open wg-easy admin',
      open_ext:     'Open in browser ↗',
      ready:        'Ready.',
      setup_msg:    'Installing/starting wg-easy (approve the Docker command when asked)…',
      setup_failed: 'Setup failed (is Docker installed? does the user have docker permissions?).',
      reachable_at: 'Admin UI reachable at {0}',
      first_time:   'Open it, complete the first-run wizard, then add a client and scan its QR.',
      rerun:        'Re-run setup',
      error:        'Error: {0}',
    },
    ar: {
      desc:         'يشغّل wg-easy في Docker على الخادم البعيد. بعد الإعداد، افتح واجهة المسؤول لإتمام معالج التشغيل الأول، ثم أضف العملاء وامسح رموز QR الخاصة بهم.',
      setup_btn:    'تثبيت wg-easy وتشغيله',
      open_admin:   'فتح لوحة تحكم wg-easy',
      open_ext:     'فتح في المتصفح ↗',
      ready:        'جاهز.',
      setup_msg:    'جارٍ تثبيت/تشغيل wg-easy (وافق على أمر Docker عند الطلب)…',
      setup_failed: 'فشل الإعداد (هل Docker مثبت؟ هل المستخدم لديه صلاحيات Docker؟).',
      reachable_at: 'واجهة المسؤول متاحة على {0}',
      first_time:   'افتحها، أكمل معالج التشغيل الأول، ثم أضف عميلاً وامسح رمز QR الخاص به.',
      rerun:        'إعادة الإعداد',
      error:        'خطأ: {0}',
    },
    bn: {
      desc:         'রিমোটে Docker-এ wg-easy চালায়। সেটআপের পরে, প্রথম-রান উইজার্ড সম্পন্ন করতে অ্যাডমিন UI খুলুন, তারপর ক্লায়েন্ট যোগ করুন এবং তাদের QR কোড স্ক্যান করুন।',
      setup_btn:    'wg-easy ইনস্টল ও চালু করুন',
      open_admin:   'wg-easy অ্যাডমিন খুলুন',
      open_ext:     'ব্রাউজারে খুলুন ↗',
      ready:        'প্রস্তুত।',
      setup_msg:    'wg-easy ইনস্টল/চালু হচ্ছে (অনুরোধ করলে Docker কমান্ড অনুমোদন করুন)…',
      setup_failed: 'সেটআপ ব্যর্থ (Docker ইনস্টল আছে কি? ব্যবহারকারীর Docker অনুমতি আছে কি?)।',
      reachable_at: 'অ্যাডমিন UI {0}-এ পাওয়া যাচ্ছে',
      first_time:   'এটি খুলুন, প্রথম-রান উইজার্ড সম্পূর্ণ করুন, তারপর একটি ক্লায়েন্ট যোগ করুন এবং QR স্ক্যান করুন।',
      rerun:        'পুনরায় সেটআপ করুন',
      error:        'ত্রুটি: {0}',
    },
    de: {
      desc:         'Führt wg-easy in Docker auf dem Remote-Server aus. Nach der Einrichtung den Admin-Bereich öffnen, den Erststart-Assistenten abschließen, dann Clients hinzufügen und deren QR-Codes scannen.',
      setup_btn:    'wg-easy installieren & starten',
      open_admin:   'wg-easy Admin öffnen',
      open_ext:     'Im Browser öffnen ↗',
      ready:        'Bereit.',
      setup_msg:    'wg-easy wird installiert/gestartet (Docker-Befehl bei Aufforderung bestätigen)…',
      setup_failed: 'Einrichtung fehlgeschlagen (Docker installiert? Hat der Benutzer Docker-Berechtigungen?).',
      reachable_at: 'Admin-Bereich erreichbar unter {0}',
      first_time:   'Öffnen, den Erststart-Assistenten abschließen, dann einen Client hinzufügen und dessen QR-Code scannen.',
      rerun:        'Setup erneut ausführen',
      error:        'Fehler: {0}',
    },
    es: {
      desc:         'Ejecuta wg-easy en Docker en el servidor remoto. Después de la configuración, abre la UI de administración para completar el asistente inicial, luego añade clientes y escanea sus códigos QR.',
      setup_btn:    'Instalar & iniciar wg-easy',
      open_admin:   'Abrir admin de wg-easy',
      open_ext:     'Abrir en el navegador ↗',
      ready:        'Listo.',
      setup_msg:    'Instalando/iniciando wg-easy (aprueba el comando Docker cuando se solicite)…',
      setup_failed: 'Error en la configuración (¿está instalado Docker? ¿tiene el usuario permisos de Docker?).',
      reachable_at: 'UI de administración disponible en {0}',
      first_time:   'Ábrelo, completa el asistente inicial, luego añade un cliente y escanea su QR.',
      rerun:        'Volver a configurar',
      error:        'Error: {0}',
    },
    fr: {
      desc:         'Lance wg-easy dans Docker sur le serveur distant. Après la configuration, ouvre l\'interface admin pour terminer l\'assistant de premier démarrage, puis ajoute des clients et scanne leurs codes QR.',
      setup_btn:    'Installer & démarrer wg-easy',
      open_admin:   'Ouvrir l\'admin wg-easy',
      open_ext:     'Ouvrir dans le navigateur ↗',
      ready:        'Prêt.',
      setup_msg:    'Installation/démarrage de wg-easy (approuver la commande Docker si demandé)…',
      setup_failed: 'Échec de la configuration (Docker installé ? L\'utilisateur a-t-il les droits Docker ?).',
      reachable_at: 'Interface admin accessible à {0}',
      first_time:   'Ouvrir, terminer l\'assistant de premier démarrage, puis ajouter un client et scanner son QR.',
      rerun:        'Relancer la configuration',
      error:        'Erreur : {0}',
    },
    hi: {
      desc:         'रिमोट पर Docker में wg-easy चलाता है। सेटअप के बाद, पहली बार चलाने के विज़ार्ड को पूरा करने के लिए एडमिन UI खोलें, फिर क्लाइंट जोड़ें और उनके QR कोड स्कैन करें।',
      setup_btn:    'wg-easy इंस्टॉल करें और शुरू करें',
      open_admin:   'wg-easy एडमिन खोलें',
      open_ext:     'ब्राउज़र में खोलें ↗',
      ready:        'तैयार।',
      setup_msg:    'wg-easy इंस्टॉल/शुरू हो रहा है (पूछे जाने पर Docker कमांड स्वीकृत करें)…',
      setup_failed: 'सेटअप विफल (क्या Docker इंस्टॉल है? क्या यूज़र के पास Docker अनुमतियाँ हैं?)।',
      reachable_at: 'एडमिन UI {0} पर उपलब्ध',
      first_time:   'इसे खोलें, पहली बार चलाने का विज़ार्ड पूरा करें, फिर एक क्लाइंट जोड़ें और उसका QR स्कैन करें।',
      rerun:        'सेटअप फिर से चलाएं',
      error:        'त्रुटि: {0}',
    },
    id: {
      desc:         'Menjalankan wg-easy di Docker pada host jarak jauh. Setelah setup, buka UI admin untuk menyelesaikan wizard pertama kali, lalu tambahkan klien dan pindai kode QR mereka.',
      setup_btn:    'Pasang & jalankan wg-easy',
      open_admin:   'Buka admin wg-easy',
      open_ext:     'Buka di browser ↗',
      ready:        'Siap.',
      setup_msg:    'Memasang/menjalankan wg-easy (setujui perintah Docker saat diminta)…',
      setup_failed: 'Setup gagal (apakah Docker terpasang? apakah pengguna memiliki izin Docker?).',
      reachable_at: 'UI admin tersedia di {0}',
      first_time:   'Buka, selesaikan wizard pertama kali, lalu tambahkan klien dan pindai QR-nya.',
      rerun:        'Jalankan ulang pengaturan',
      error:        'Kesalahan: {0}',
    },
    ja: {
      desc:         'リモートのDockerでwg-easyを実行します。セットアップ後、管理UIを開いて初回ウィザードを完了し、クライアントを追加してQRコードをスキャンしてください。',
      setup_btn:    'wg-easy をインストール・起動',
      open_admin:   'wg-easy 管理画面を開く',
      open_ext:     'ブラウザで開く ↗',
      ready:        '準備完了。',
      setup_msg:    'wg-easyをインストール/起動中（Dockerコマンドの承認を求められたら承認してください）…',
      setup_failed: 'セットアップ失敗（Dockerはインストール済みですか？ユーザーにDocker権限がありますか？）。',
      reachable_at: '管理UIは {0} で利用できます',
      first_time:   '開いて初回ウィザードを完了し、クライアントを追加してQRコードをスキャンしてください。',
      rerun:        'セットアップを再実行',
      error:        'エラー: {0}',
    },
    mr: {
      desc:         'रिमोटवर Docker मध्ये wg-easy चालवतो. सेटअप नंतर, पहिल्यांदा चालवण्याचा विझार्ड पूर्ण करण्यासाठी अॅडमिन UI उघडा, नंतर क्लायंट जोडा आणि त्यांचे QR कोड स्कॅन करा.',
      setup_btn:    'wg-easy इन्स्टॉल करा आणि सुरू करा',
      open_admin:   'wg-easy अॅडमिन उघडा',
      open_ext:     'ब्राउझरमध्ये उघडा ↗',
      ready:        'तयार.',
      setup_msg:    'wg-easy इन्स्टॉल/सुरू होत आहे (विचारल्यावर Docker आदेश मंजूर करा)…',
      setup_failed: 'सेटअप अयशस्वी (Docker इन्स्टॉल आहे का? वापरकर्त्याला Docker परवानग्या आहेत का?).',
      reachable_at: 'अॅडमिन UI {0} वर उपलब्ध',
      first_time:   'उघडा, पहिल्यांदा चालवण्याचा विझार्ड पूर्ण करा, नंतर क्लायंट जोडा आणि त्याचा QR स्कॅन करा.',
      rerun:        'पुन्हा सेटअप करा',
      error:        'त्रुटी: {0}',
    },
    pcm: {
      desc:         'E go run wg-easy for Docker on top of remote host. After setup, open admin UI finish the first-run wizard, then add clients and scan their QR codes.',
      setup_btn:    'Install & start wg-easy',
      open_admin:   'Open wg-easy admin',
      open_ext:     'Open for browser ↗',
      ready:        'E don ready.',
      setup_msg:    'E dey install/start wg-easy (approve the Docker command when dem ask)…',
      setup_failed: 'Setup fail (Docker installed? the user get docker permissions?).',
      reachable_at: 'Admin UI dey for {0}',
      first_time:   'Open am, finish the first-run wizard, then add client and scan the QR.',
      rerun:        'Run setup again',
      error:        'Error: {0}',
    },
    pt: {
      desc:         'Executa o wg-easy no Docker no host remoto. Após a configuração, abra a UI de administração para concluir o assistente de primeira execução, adicione clientes e escaneie os QR codes.',
      setup_btn:    'Instalar & iniciar wg-easy',
      open_admin:   'Abrir admin do wg-easy',
      open_ext:     'Abrir no navegador ↗',
      ready:        'Pronto.',
      setup_msg:    'Instalando/iniciando wg-easy (aprove o comando Docker quando solicitado)…',
      setup_failed: 'Falha na configuração (Docker instalado? o usuário tem permissões Docker?).',
      reachable_at: 'UI de administração disponível em {0}',
      first_time:   'Abra, conclua o assistente de primeira execução, adicione um cliente e escaneie o QR.',
      rerun:        'Executar configuração novamente',
      error:        'Erro: {0}',
    },
    ru: {
      desc:         'Запускает wg-easy в Docker на удалённом хосте. После настройки откройте панель администратора, завершите мастер первого запуска, добавьте клиентов и отсканируйте их QR-коды.',
      setup_btn:    'Установить и запустить wg-easy',
      open_admin:   'Открыть панель wg-easy',
      open_ext:     'Открыть в браузере ↗',
      ready:        'Готово.',
      setup_msg:    'Установка/запуск wg-easy (подтвердите команду Docker по запросу)…',
      setup_failed: 'Ошибка настройки (Docker установлен? У пользователя есть права Docker?).',
      reachable_at: 'Панель администратора доступна по адресу {0}',
      first_time:   'Откройте, завершите мастер первого запуска, затем добавьте клиента и отсканируйте его QR-код.',
      rerun:        'Повторить настройку',
      error:        'Ошибка: {0}',
    },
    ta: {
      desc:         'தொலைதூர ஹோஸ்டில் Docker-ல் wg-easy இயக்குகிறது. அமைத்த பிறகு, முதல்-இயக்க வழிகாட்டியை முடிக்க அட்மின் UI திறக்கவும், பின் கிளையண்டுகளை சேர்த்து QR குறியீடுகளை ஸ்கேன் செய்யவும்.',
      setup_btn:    'wg-easy நிறுவி தொடங்கு',
      open_admin:   'wg-easy அட்மினை திற',
      open_ext:     'உலாவியில் திற ↗',
      ready:        'தயார்.',
      setup_msg:    'wg-easy நிறுவுகிறது/தொடங்குகிறது (Docker கட்டளையை அங்கீகரிக்கவும்)…',
      setup_failed: 'அமைவு தோல்வியடைந்தது (Docker நிறுவப்பட்டுள்ளதா? பயனருக்கு Docker அனுமதிகள் உள்ளனவா?).',
      reachable_at: 'அட்மின் UI {0}-ல் கிடைக்கிறது',
      first_time:   'திறந்து, முதல்-இயக்க வழிகாட்டியை முடிக்கவும், பின் ஒரு கிளையண்டை சேர்த்து அதன் QR ஐ ஸ்கேன் செய்யவும்.',
      rerun:        'அமைப்பை மீண்டும் இயக்கு',
      error:        'பிழை: {0}',
    },
    te: {
      desc:         'రిమోట్ హోస్ట్‌లో Docker-లో wg-easy నడుపుతుంది. సెటప్ తర్వాత, మొదటి-రన్ విజార్డ్ పూర్తి చేయడానికి అడ్మిన్ UI తెరవండి, తర్వాత క్లయింట్‌లను జోడించి వారి QR కోడ్‌లను స్కాన్ చేయండి.',
      setup_btn:    'wg-easy ఇన్‌స్టాల్ చేసి ప్రారంభించు',
      open_admin:   'wg-easy అడ్మిన్ తెరువు',
      open_ext:     'బ్రౌజర్‌లో తెరువు ↗',
      ready:        'సిద్ధంగా ఉంది.',
      setup_msg:    'wg-easy ఇన్‌స్టాల్/ప్రారంభమవుతోంది (అడిగినప్పుడు Docker ఆదేశాన్ని ఆమోదించండి)…',
      setup_failed: 'సెటప్ విఫలమైంది (Docker ఇన్‌స్టాల్ అయిందా? వినియోగదారుకి Docker అనుమతులు ఉన్నాయా?).',
      reachable_at: 'అడ్మిన్ UI {0} వద్ద అందుబాటులో ఉంది',
      first_time:   'తెరవండి, మొదటి-రన్ విజార్డ్ పూర్తి చేయండి, తర్వాత ఒక క్లయింట్ జోడించి దాని QR స్కాన్ చేయండి.',
      rerun:        'సెటప్ తిరిగి అమలు చేయి',
      error:        'లోపం: {0}',
    },
    tr: {
      desc:         'Uzak sunucuda Docker\'da wg-easy çalıştırır. Kurulumdan sonra, ilk çalıştırma sihirbazını tamamlamak için yönetici arayüzünü açın, ardından istemci ekleyin ve QR kodlarını tarayın.',
      setup_btn:    'wg-easy kur & başlat',
      open_admin:   'wg-easy yöneticisini aç',
      open_ext:     'Tarayıcıda aç ↗',
      ready:        'Hazır.',
      setup_msg:    'wg-easy kuruluyor/başlatılıyor (istendiğinde Docker komutunu onaylayın)…',
      setup_failed: 'Kurulum başarısız (Docker kurulu mu? kullanıcının Docker izni var mı?).',
      reachable_at: 'Yönetici arayüzü {0} adresinde erişilebilir',
      first_time:   'Açın, ilk çalıştırma sihirbazını tamamlayın, ardından istemci ekleyin ve QR kodunu tarayın.',
      rerun:        'Kurulumu yeniden çalıştır',
      error:        'Hata: {0}',
    },
    ur: {
      desc:         'ریموٹ ہوسٹ پر Docker میں wg-easy چلاتا ہے۔ سیٹ اپ کے بعد، پہلی بار چلانے کا وزرڈ مکمل کرنے کے لیے ایڈمن UI کھولیں، پھر کلائنٹ شامل کریں اور ان کے QR کوڈ اسکین کریں۔',
      setup_btn:    'wg-easy انسٹال کریں اور شروع کریں',
      open_admin:   'wg-easy ایڈمن کھولیں',
      open_ext:     'براؤزر میں کھولیں ↗',
      ready:        'تیار۔',
      setup_msg:    'wg-easy انسٹال/شروع ہو رہا ہے (مانگنے پر Docker کمانڈ منظور کریں)…',
      setup_failed: 'سیٹ اپ ناکام (Docker انسٹال ہے؟ صارف کے پاس Docker کی اجازتیں ہیں؟)۔',
      reachable_at: 'ایڈمن UI {0} پر دستیاب ہے',
      first_time:   'کھولیں، پہلی بار چلانے کا وزرڈ مکمل کریں، پھر کلائنٹ شامل کریں اور اس کا QR اسکین کریں۔',
      rerun:        'سیٹ اپ دوبارہ چلائیں',
      error:        'خرابی: {0}',
    },
    'zh-CN': {
      desc:         '在远程主机的 Docker 中运行 wg-easy。设置完成后，打开管理界面完成初次向导，然后添加客户端并扫描其 QR 码。',
      setup_btn:    '安装并启动 wg-easy',
      open_admin:   '打开 wg-easy 管理面板',
      open_ext:     '在浏览器中打开 ↗',
      ready:        '就绪。',
      setup_msg:    '正在安装/启动 wg-easy（被询问时请批准 Docker 命令）…',
      setup_failed: '安装失败（Docker 已安装？用户有 Docker 权限吗？）。',
      reachable_at: '管理界面可在 {0} 访问',
      first_time:   '打开它，完成初次向导，然后添加客户端并扫描其 QR 码。',
      rerun:        '重新安装',
      error:        '错误：{0}',
    },
    'zh-HK': {
      desc:         '在遠端主機的 Docker 中運行 wg-easy。設置完成後，開啟管理介面完成初次向導，然後新增客戶端並掃描其 QR 碼。',
      setup_btn:    '安裝並啟動 wg-easy',
      open_admin:   '開啟 wg-easy 管理面板',
      open_ext:     '在瀏覽器中開啟 ↗',
      ready:        '就緒。',
      setup_msg:    '正在安裝/啟動 wg-easy（被詢問時請批准 Docker 指令）…',
      setup_failed: '安裝失敗（Docker 已安裝？使用者有 Docker 權限嗎？）。',
      reachable_at: '管理介面可在 {0} 存取',
      first_time:   '開啟它，完成初次向導，然後新增客戶端並掃描其 QR 碼。',
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

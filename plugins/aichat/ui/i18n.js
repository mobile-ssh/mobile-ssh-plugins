/* i18n for the AI Chat plugin. window.t(key, ...subs) is available before DOMContentLoaded. */
(function () {
  'use strict';

  var S = {
    en: {
      connecting:   'connecting…',
      placeholder:  'Message…',
      send:         'Send',
      setup_msg:    'Setting up Ollama + {0} (approve the commands when asked)…',
      setup_failed: 'Setup failed — see the SSH output.',
      ready_chat:   'Ready. Say hello.',
      error:        'Error: {0}',
    },
    ar: {
      connecting:   'جارٍ الاتصال…',
      placeholder:  'رسالة…',
      send:         'إرسال',
      setup_msg:    'جارٍ إعداد Ollama + {0} (وافق على الأوامر عند الطلب)…',
      setup_failed: 'فشل الإعداد — راجع مخرجات SSH.',
      ready_chat:   'جاهز. قل مرحباً.',
      error:        'خطأ: {0}',
    },
    bn: {
      connecting:   'সংযুক্ত হচ্ছে…',
      placeholder:  'বার্তা…',
      send:         'পাঠান',
      setup_msg:    'Ollama + {0} সেটআপ হচ্ছে (অনুরোধ করলে কমান্ড অনুমোদন করুন)…',
      setup_failed: 'সেটআপ ব্যর্থ — SSH আউটপুট দেখুন।',
      ready_chat:   'প্রস্তুত। হ্যালো বলুন।',
      error:        'ত্রুটি: {0}',
    },
    de: {
      connecting:   'Verbinde…',
      placeholder:  'Nachricht…',
      send:         'Senden',
      setup_msg:    'Ollama + {0} wird eingerichtet (Befehle bei Aufforderung bestätigen)…',
      setup_failed: 'Einrichtung fehlgeschlagen — SSH-Ausgabe prüfen.',
      ready_chat:   'Bereit. Sag Hallo.',
      error:        'Fehler: {0}',
    },
    es: {
      connecting:   'conectando…',
      placeholder:  'Mensaje…',
      send:         'Enviar',
      setup_msg:    'Configurando Ollama + {0} (aprueba los comandos cuando se solicite)…',
      setup_failed: 'Error en la configuración — consulta la salida de SSH.',
      ready_chat:   'Listo. Di hola.',
      error:        'Error: {0}',
    },
    fr: {
      connecting:   'connexion…',
      placeholder:  'Message…',
      send:         'Envoyer',
      setup_msg:    'Configuration d’Ollama + {0} (approuver les commandes si demandé)…',
      setup_failed: 'Échec de la configuration — voir la sortie SSH.',
      ready_chat:   'Prêt. Dites bonjour.',
      error:        'Erreur : {0}',
    },
    hi: {
      connecting:   'कनेक्ट हो रहा है…',
      placeholder:  'संदेश…',
      send:         'भेजें',
      setup_msg:    'Ollama + {0} सेटअप हो रहा है (पूछे जाने पर कमांड स्वीकृत करें)…',
      setup_failed: 'सेटअप विफल — SSH आउटपुट देखें।',
      ready_chat:   'तैयार। नमस्ते कहें।',
      error:        'त्रुटि: {0}',
    },
    id: {
      connecting:   'menghubungkan…',
      placeholder:  'Pesan…',
      send:         'Kirim',
      setup_msg:    'Menyiapkan Ollama + {0} (setujui perintah saat diminta)…',
      setup_failed: 'Penyiapan gagal — lihat keluaran SSH.',
      ready_chat:   'Siap. Ucapkan halo.',
      error:        'Kesalahan: {0}',
    },
    ja: {
      connecting:   '接続中…',
      placeholder:  'メッセージ…',
      send:         '送信',
      setup_msg:    'Ollama + {0} をセットアップ中（コマンドの承認を求められたら承認してください）…',
      setup_failed: 'セットアップ失敗 — SSHの出力を確認してください。',
      ready_chat:   '準備完了。挨拶してみましょう。',
      error:        'エラー: {0}',
    },
    mr: {
      connecting:   'कनेक्ट होत आहे…',
      placeholder:  'संदेश…',
      send:         'पाठवा',
      setup_msg:    'Ollama + {0} सेट होत आहे (विचारल्यावर आदेश मंजूर करा)…',
      setup_failed: 'सेटअप अयशस्वी — SSH आउटपुट पहा.',
      ready_chat:   'तयार. नमस्कार म्हणा.',
      error:        'त्रुटी: {0}',
    },
    pcm: {
      connecting:   'e dey connect…',
      placeholder:  'Message…',
      send:         'Send',
      setup_msg:    'E dey set up Ollama + {0} (approve the commands when dem ask)…',
      setup_failed: 'Setup fail — check SSH output.',
      ready_chat:   'E don ready. Say hello.',
      error:        'Error: {0}',
    },
    pt: {
      connecting:   'conectando…',
      placeholder:  'Mensagem…',
      send:         'Enviar',
      setup_msg:    'Configurando Ollama + {0} (aprove os comandos quando solicitado)…',
      setup_failed: 'Falha na configuração — veja a saída SSH.',
      ready_chat:   'Pronto. Diga olá.',
      error:        'Erro: {0}',
    },
    ru: {
      connecting:   'подключение…',
      placeholder:  'Сообщение…',
      send:         'Отправить',
      setup_msg:    'Настройка Ollama + {0} (подтверждайте команды по запросу)…',
      setup_failed: 'Ошибка настройки — см. вывод SSH.',
      ready_chat:   'Готово. Поздоровайтесь.',
      error:        'Ошибка: {0}',
    },
    ta: {
      connecting:   'இணைக்கிறது…',
      placeholder:  'செய்தி…',
      send:         'அனுப்பு',
      setup_msg:    'Ollama + {0} அமைக்கிறது (கேட்கும்போது கட்டளைகளை அங்கீகரிக்கவும்)…',
      setup_failed: 'அமைவு தோல்வியடைநதது — SSH வெளியீடைப் பாருங்கள்.',
      ready_chat:   'தயார். வணக்கம் சொல்லுங்கள்.',
      error:        'பிழை: {0}',
    },
    te: {
      connecting:   'కనెక్ట్ అవుతోంది…',
      placeholder:  'సందేశం…',
      send:         'పంపు',
      setup_msg:    'Ollama + {0} సెటప్ అవుతోంది (అడిగినప్పుడు ఆదేశాలను ఆమోదించండి)…',
      setup_failed: 'సెటప్ విఫలమైంది — SSH అవుట్‌పుట్ చూడండి.',
      ready_chat:   'సిద్ధంగా ఉంది. హలో చెప్పండి.',
      error:        'లోపం: {0}',
    },
    tr: {
      connecting:   'bağlanıyor…',
      placeholder:  'Mesaj…',
      send:         'Gönder',
      setup_msg:    'Ollama + {0} kuruluyor (istenildiğinde komutları onaylayın)…',
      setup_failed: 'Kurulum başarısız — SSH çıktısına bakın.',
      ready_chat:   'Hazır. Merhaba deyin.',
      error:        'Hata: {0}',
    },
    ur: {
      connecting:   'کنیکٹ ہو رہا ہے…',
      placeholder:  'پیغام…',
      send:         'بھیجیں',
      setup_msg:    'Ollama + {0} سیٹ اپ ہو رہا ہے (مانگنے پر کمانڈز منظور کریں)…',
      setup_failed: 'سیٹ اپ ناکام — SSH آؤٹ پٹ دیکھیں۔',
      ready_chat:   'تیار۔ ہیلو کہیں۔',
      error:        'خرابی: {0}',
    },
    'zh-CN': {
      connecting:   '连接中…',
      placeholder:  '消息…',
      send:         '发送',
      setup_msg:    '正在安装 Ollama + {0}（被询问时请批准命令）…',
      setup_failed: '安装失败 — 请查看 SSH 输出。',
      ready_chat:   '就绪。打个招呼吧。',
      error:        '错误：{0}',
    },
    'zh-HK': {
      connecting:   '連接中…',
      placeholder:  '訊息…',
      send:         '傳送',
      setup_msg:    '正在安裝 Ollama + {0}（被詢問時請批准指令）…',
      setup_failed: '安裝失敗 — 請查看 SSH 輸出。',
      ready_chat:   '就緒。說聲您好吧。',
      error:        '錯誤：{0}',
    },
  };
  S['ar-EG'] = S['ar'];

  var MAP = { 'in': 'id', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN', 'zh-tw': 'zh-HK', 'zh-hant': 'zh-HK' };

  function resolve() {
    var nav = (navigator.language || 'en').toLowerCase();
    var mapped = MAP[nav] || nav;
    if (S[mapped]) return mapped;
    // Try with normalised region, e.g. "ar-eg" → "ar-EG"
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
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPh);
    });
    if (locale === 'ar' || locale === 'ar-EG' || locale === 'ur') {
      document.documentElement.setAttribute('dir', 'rtl');
    }
  });
})();

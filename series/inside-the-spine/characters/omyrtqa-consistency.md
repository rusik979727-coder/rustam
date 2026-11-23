# ОМЫРТҚА («Тірек») — Character Consistency Prompt

> Бұл файл — кейіпкердің «ДНҚ»-сы. Барлық сериядағы барлық image/video генерацияда **өзгеріссіз** қолданылады.
> Промпттар ағылшынша (AI генераторлар жақсы түсінеді), түсіндірме қазақша.

---

## 1. Визуалды паспорт (қазақша)

| Параметр | Бекітілген мән |
|---|---|
| Пішіні | Тік тұрған, жеңіл S-тәрізді иілген омыртқа бағаны; 9 көрінетін стилизацияланған сегмент (жоғарыдан төмен кішіден үлкенге) |
| Бас | Ең жоғарғы сегмент — сәл үлкейтілген, жұмыр, бет осында |
| Көздер | Үлкен, бадам пішінді, **янтарь-алтын** (`#E8A23A`) қарашық, екі ақ жылтыр нүкте (catchlight), қалың «кірпік» жоқ |
| Қас | Көздің үстіндегі екі кішкентай сүйек өсіндісі (стилизацияланған көлденең өсінділер) — эмоцияны көрсетеді |
| Ауыз | Жұқа, кең, мейірімді; күлгенде бір жағы көбірек көтеріледі (асимметриялы күлкі — қолтаңба) |
| «Қолдар» | Ортаңғы сегменттің көлденең өсінділері (processus transversus) созылып, саусақсыз жұмсақ «қол» қызметін атқарады |
| Текстура | Тегіс, жартылай жылтыр піл сүйегі, микро-кеуектер, subsurface scattering (жарық сәл өтеді) |
| Түсі | Жылы піл сүйегі `#EDE3CF`, сегмент жиектері сәл қоңырқай |
| Сегменттер арасы | Әр сегменттің арасында кішкентай күлгін-көк дискілер көрінеді |
| Жарық қолтаңбасы | Арт жағынан әрқашан жылы алтын rim light |
| Биіктігі (кадрда) | Диск кейіпкерінен ~6 есе биік |
| Анатомия | Әр сегментте артқы өсінді (processus spinosus), алдыңғы дене бөлігі, ортасында канал саңылауы — шынайы, бірақ жұмсартылған |

**Мінез арқылы қозғалыс:** қозғалыс төменнен жоғары толқынмен жүреді (сегменттер 2–3 кадр кешігумен). Ешқашан «резеңке» сияқты созылмайды — иілгіштігі шынайы омыртқа шегінде.

---

## 2. MASTER PROMPT (ағылшынша — көшіріп қолдану)

```
"TIREK" the Spine character: a living anthropomorphic human spinal column,
standing upright with a gentle natural S-curve, made of 9 stylized vertebra
segments that grow slightly larger from top to bottom. The top vertebra is
slightly enlarged and rounded and forms the head, with large expressive
almond-shaped amber-gold eyes (#E8A23A) with two soft white catchlights,
small bony ridge eyebrows, and a wide, thin, kind mouth with a subtle
asymmetrical smile. Transverse processes of the middle vertebrae act as soft
fingerless arms. Each vertebra has an anatomically plausible body, spinous
process and neural arch, softened and stylized. Small glossy violet-blue
intervertebral discs visible between every segment. Surface: warm ivory bone
(#EDE3CF), satin finish, micro-porous texture, subtle subsurface scattering,
slightly darker warm edges. Always lit with a warm golden rim light from
behind. Personality: wise, kind, brave, calm leader with a warm sense of
humor. Pixar-quality 3D feature film character, appealing proportions,
cinematic, not childish, not cheap cartoon.
```

## 3. NEGATIVE PROMPT (барлық генерацияға)

```
skeleton skull, horror, scary, gore, blood, realistic human face, human body,
arms with fingers, legs, clothes, extra eyes, cartoonish flat 2D, cheap toy
look, plastic toy, low poly, chibi, anime, deformed anatomy, extra segments,
broken spine, cracks on the spine, white blank eyes, red eyes, text,
watermark, logo, blurry, noisy
```

## 4. Эмоция кестесі (expression sheet)

| Эмоция | Көз | Қас | Ауыз | Дене | Промпт қосымшасы |
|---|---|---|---|---|---|
| Сәлемдесу / қуаныш | Кең ашық, жарқыраған | Жоғары | Асимметриялы кең күлкі | Жоғарғы сегмент сәл шалқаяды, «қол» бұлғайды | `warm welcoming smile, one arm waving, slight lean back` |
| Мақтаныш | Сәл қысыңқы | Бір қасы жоғары | Жартылай күлкі | Тік, «кеуде» алға | `proud confident half-smile, one eyebrow raised, standing tall` |
| Қызығушылық | Үлкейген | Бір жаққа қисайған | Жабық | Басы бір жаққа қисайған | `curious head tilt, wide eyes` |
| Алаңдау (5-кадр) | Қарашық кішірейген | Ортасы жоғары түйілген | Түзу сызық | Баяу бұрылу, иық түсіңкі | `subtle concern, brows knitted upward, slow turn, mouth flat` |
| Күлу | Жарты ай | Жоғары | Ашық күлкі | Бүкіл дене толқынмен селкілдейді | `laughing, eyes crescent-shaped, body bouncing in a wave` |

## 5. Дауыс сипаттамасы (voice casting)

- **Тембр:** жылы баритон, 30–40 жас ер адам дауысы.
- **Мәнері:** асықпай, сенімді, «үлкен аға». Сөйлем ортасында кішкене кідіріс («Сен жүргенде... отырған кезде...»).
- **AI voice (ElevenLabs т.б.) параметрлері:** Stability 55–60%, Similarity 75%, Style 25%. Ұқсас дауыс: warm, friendly, mid-low male narrator.

## 6. Сериядан серияға сақтау ережелері

1. Әр генерацияда **MASTER PROMPT + NEGATIVE** толық қойылады; тек сахна/эмоция бөлігі ауысады.
2. Midjourney: алғашқы сәтті кадрды `--cref <url> --cw 100` ретінде қолдану (фон өзгергенде `--cw 60`).
3. Flux / SDXL: кейіпкер бойынша LoRA үйрету (15–25 сурет: 4 ракурс × 5 эмоция + толық бой).
4. Kling / Runway: image-to-video режимінде **тек** бекітілген reference кадрдан бастау.
5. Көз түсі, rim light және сегмент саны — ешқашан өзгермейтін үш белгі. Біреуі өзгерсе — кадр қайта генерацияланады.
6. `seed` мәнін тіркеп отыру (әр кадр үшін кестеде сақтау).

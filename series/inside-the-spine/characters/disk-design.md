# ДИСК («Жұмсақ») — Character Design Prompt

> Омыртқааралық дискінің мультфильмдік кейіпкері. Көңілді, әзілқой «кішкентай іні».
> 1-серияда проблемасы жоқ — бірақ оның құрылымы 2-серияның сюжеттік негізі.

---

## 1. Визуалды паспорт (қазақша)

| Параметр | Бекітілген мән |
|---|---|
| Пішіні | Жұмсақ, сопақ «шайба» / жастық, бүйірінен қарағанда бүйрек тәрізді (шынайы диск сияқты) |
| Құрылымы (анатомия) | **Сыртқы қабат** — annulus fibrosus: бірнеше жұқа, мөлдір, концентрлі сақина-қабаттан тұрады, талшықтары қиғаш. **Ішкі ядро** — nucleus pulposus: ортасында жұмсақ жарқырайтын гель |
| Түсі | Сыртқы қабат: күлгін `#7B6CF6` → көгілдір `#5AA9F0` градиент; ядро: жарқыраған ашық күлгін-ақ `#CFC6FF` |
| Материал | Жартылай мөлдір желе / гель, ылғалды жылтыр (specular highlights), subsurface scattering |
| Көздер | Үлкен, дөңгелек, қап-қара қарашық, ақ жылтыр нүкте; Омыртқаның көзінен дөңгелегірек → жастау көрінеді |
| Ауыз | Кішкентай, қозғалмалы, жиі ашық күлкі; күлгенде бір тісі көрінбейді — тіс жоқ, тек гель |
| Қол-аяқ | Жоқ. Қозғалыс тек дене арқылы: сығылу, созылу, бұралу, секіру |
| Өлшемі | Омыртқадан ~6 есе кіші; алақанға сыятын «жастық» масштабы |
| Ерекше белгі | Күлгенде/қуанғанда **ішкі ядросы жыпылықтап жарқырайды** — эмоция индикаторы |
| Жарық қолтаңбасы | Ішінен шығатын жұмсақ күлгін жарық (inner glow), айналасына күлгін рефлекс түседі |

**Мінез арқылы қозғалыс:** squash & stretch — секірер алдында сығылады, ауада созылады, жерге түскенде «желе» сияқты дірілдейді (2–3 тербеліс). Тыныш тұрғанда да баяу «тыныс алады» (1 сек — кеңейіп, 1 сек — сығылып).

---

## 2. MASTER PROMPT (ағылшынша)

```
"ZHUMSAK" the Disc character: a small, cute, living intervertebral disc,
soft oval cushion shape, kidney-shaped when seen from the top. Anatomically
inspired: an outer ring made of several thin translucent concentric layers
with subtle diagonal fibers (annulus fibrosus) and a softly glowing gel core
in the center (nucleus pulposus) visible through the translucent layers.
Color: glossy violet (#7B6CF6) to sky blue (#5AA9F0) gradient, glowing
lavender-white core (#CFC6FF). Material: translucent jelly, wet glossy
specular highlights, strong subsurface scattering, soft inner glow casting
violet bounce light around it. Big round expressive eyes with dark pupils and
white catchlights, small playful open-mouth smile, no arms, no legs, moves
by squash and stretch. Personality: cheerful, playful, joking, energetic
little brother of the team. Pixar-quality 3D feature film character,
appealing, cinematic lighting, not childish, not cheap.
```

## 3. NEGATIVE PROMPT

```
arms, legs, hands, teeth, tongue, hair, clothes, horror, slime monster,
dirty, rotten, cracks, damage, torn, deflated, flat 2D cartoon, toy plastic,
low poly, anime, chibi, extra eyes, text, watermark, logo
```
> Ескерту: 5–6-кадрда «cracks, damage» negative-тен **алынып тасталады** (жарықшақ әдейі көрсетіледі).

## 4. Эмоция кестесі

| Эмоция | Сипаттама | Промпт қосымшасы |
|---|---|---|
| Көңілді (default) | Көзі кең, ауызы ашық, ядро жарқыраған | `cheerful open smile, core glowing brightly` |
| Мақтанған | Сәл созылып «бойын түзейді», бір көзін қысады | `stretching tall proudly, winking` |
| Күлу | Сығылып-кеңейіп селкілдейді | `giggling, body jiggling like jelly` |
| Сенімсіз (5-кадр) | Сәл сығылған, көзі жан-жаққа, ядро жарығы әлсіреген | `uncertain small smile, eyes glancing sideways, core glow dimmer, slightly compressed` |
| Шаршаған (2-серия) | Жалпайған, түсі солғын, ядро күңгірт | `flattened, tired droopy eyes, faded colors, dim core` |

## 5. Дауыс сипаттамасы

- **Тембр:** жоғарылау, жеңіл, жас (18–25 жас), жыныссыз-бейтарап немесе жас жігіт дауысы.
- **Мәнері:** жылдам, ойнақы, сөз соңын созады («Ал ме-ен — дискі-и!»). Сөйлем арасында кішкентай күлкі.
- **AI voice параметрлері:** Stability 35–40% (көбірек эмоция), Style 50–60%, жылдамдық 1.1×.

## 6. Анатомиялық дұрыстық (дәрігерге тексеру үшін)

- Диск омыртқа денелерінің **арасында** орналасады (доғаларының арасында емес).
- Annulus fibrosus — талшықты шеміршек, концентрлі пластиналар; талшықтар көршілес қабаттарда қарама-қарсы қиғаш.
- Nucleus pulposus — гель тәрізді, жоғары су құрамы; жүктемені жан-жаққа таратады.
- Ересек адамда 23 диск бар (C2–S1 аралығы).
- 2-серияның драматургиясы: қайталанатын дұрыс емес жүктеме → annulus қабаттарында микрожарықшақтар → ядро сыртқа қарай ығысады. 1-серияда тек **алғашқы, әлсіз белгі** көрсетіледі.

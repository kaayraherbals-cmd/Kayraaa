/** A real person named on an article. Add one only with that person's confirmation; never invent a name, role or biography. */
export interface ArticlePerson {
  name: string;
  /** Their actual role, for example "Co-Founder, Kaayra Herbals". */
  role?: string;
  /** One or two sentences, written or approved by the person. */
  bio?: string;
  /** A page that shows who they are (their profile or website). */
  url?: string;
}

/** An actual review by a qualified person. Present only when practitionerReviewed is true. */
export interface ArticleReview {
  reviewer: ArticlePerson & { /** The qualification exactly as the reviewer confirmed it, for example "BAMS". */ credentials: string };
  /** ISO date the review really took place. */
  reviewedOn: string;
}

export interface Article {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO
  readingMinutes: number;
  /** Set to true only after a qualified Ayurvedic practitioner has reviewed the text. */
  practitionerReviewed: boolean;
  /**
   * Optional verified facts. Leave all of these out until they are true. When `author` is absent the article is published by the
   * company ("by Kaayra Herbals"). `review` must be present exactly when practitionerReviewed is true (a test enforces this).
   */
  author?: ArticlePerson;
  review?: ArticleReview;
  /** ISO date of the last real change to the text, when it differs from `date`. */
  updated?: string;
  /** Slugs of other articles worth reading next. If omitted, the page lists the other articles. */
  related?: string[];
  /** Slugs of ingredient-library entries this article discusses. */
  ingredients?: string[];
  body: { h?: string; p: string[] }[];
  /** Credible sources for any statement about evidence or safety. Link only pages that were opened and read. */
  sources?: { label: string; url: string }[];
}

export const articles: Article[] = [
  {
    slug: 'traditional-use-and-clinical-evidence',
    title: 'Traditional use and clinical evidence: how to read a herbal claim',
    excerpt: 'Two different kinds of statement appear on herbal products. Ashwagandha is used here as a worked example of what each one can and cannot tell you.',
    date: '2026-10-22',
    readingMinutes: 5,
    practitionerReviewed: false,
    ingredients: ['ashwagandha'],
    body: [
      {
        p: [
          'Herbal products tend to make two kinds of statement that sound alike but answer different questions. One is “used traditionally for…”. The other is “shown to…”. Telling them apart is the most useful habit a reader of herbal labels can build.',
        ],
      },
      {
        h: 'What traditional use tells you',
        p: [
          'Traditional use means a plant has a long history inside a system of practice such as Ayurveda: it is named in classical texts, prepared in particular ways and used by practitioners who know the person in front of them. That history is real and worth respecting.',
          'It does not tell you whether a particular modern product, at a particular dose, works for a particular purpose, or whether it is safe for you. Tradition describes how a plant has been used. It is not a measurement of effect.',
        ],
      },
      {
        h: 'What clinical evidence tells you',
        p: [
          'Clinical studies test a specific preparation, at a specific dose, for a specific outcome, in a specific group of people, over a specific length of time. A result is only as general as those details allow. A finding about one extract does not automatically carry over to a powder, a tea or a different extract of the same plant.',
        ],
      },
      {
        h: 'A worked example: ashwagandha',
        p: [
          'Ashwagandha (Withania somnifera) is used in Ayurvedic and Unani practice, and supplements usually contain extracts of the root or of the root and leaf. The US National Institutes of Health describe the research on stress, anxiety and sleep in careful terms: some preparations may help, several studies are small, and extracts might improve sleep. Note the wording. It is “some preparations” and “might”, not “ashwagandha works”.',
          'Safety is described with the same care. The NIH Office of Dietary Supplements reports that use appears safe for up to three months, that safety over longer periods is not clear, and that ashwagandha might cause liver problems and affect how the thyroid works. It may not be suitable for people with prostate cancer or for anyone who is pregnant or breastfeeding. The National Center for Complementary and Integrative Health also lists drowsiness and stomach upset among possible effects and advises avoiding it during pregnancy and breastfeeding.',
          'Two things follow. A plant can have a long tradition and a promising but limited body of research at the same time. And “natural” or “traditional” is not a safety statement.',
        ],
      },
      {
        h: 'Questions worth asking of any claim',
        p: [
          'Which preparation was used, and is it the same as the product in front of you? What dose and for how long? Who took part in the study, and how many of them? What was actually measured? Who says so: an independent source, or the company selling the product? And who should avoid it, including anyone who is pregnant, breastfeeding, taking medicines or living with a health condition?',
        ],
      },
      {
        h: 'How we apply this',
        p: [
          'Our products are still in development, so we make no health claims about them. When we write about a plant we say which statements are traditional use and which come from studies, and we link the source. The same principle runs through our approach to quality and transparency, and the ingredient library only records identity, not benefits.',
          'This article is general information and not medical advice. If you are considering any herbal product, speak to a qualified practitioner or doctor first.',
        ],
      },
    ],
    sources: [
      { label: 'National Center for Complementary and Integrative Health (NIH): Ashwagandha', url: 'https://nccih.nih.gov/health/ashwagandha' },
      { label: 'NIH Office of Dietary Supplements: Ashwagandha, is it helpful for stress, anxiety, or sleep?', url: 'https://ods.od.nih.gov/factsheets/Ashwagandha-Consumer/' },
    ],
  },
  {
    slug: 'reading-an-ayurvedic-label',
    title: 'Reading an Ayurvedic label',
    excerpt: 'What an ingredient list can tell you, what it cannot, and the questions worth asking about any herbal product.',
    date: '2026-10-14',
    readingMinutes: 4,
    practitionerReviewed: false,
    body: [
      {
        p: [
          'The word “Ayurvedic” on a pack describes a tradition, not a quality standard. It tells you very little about what is inside, where it came from or how it was made. The useful information is further down the label.',
        ],
      },
      {
        h: 'Start with the ingredient list',
        p: [
          'A clear list names each ingredient, ideally with the plant part used (root, leaf, fruit) and the botanical name alongside the common one. Ashwagandha, for example, is Withania somnifera; the botanical name removes doubt about which plant is meant.',
          'Notice whether an ingredient is a whole powder or an extract, and whether quantities are given. “Proprietary blend” without amounts makes comparison impossible.',
        ],
      },
      {
        h: 'Look for traceability',
        p: [
          'A batch number and a manufacturing or expiry date show that the product can be traced. The manufacturer’s name and address should be printed, and in India the product category determines which licences and labelling rules apply. If those details are missing, that is worth noticing.',
        ],
      },
      {
        h: 'Be careful with claims',
        p: [
          'Wording that promises to cure, treat or reverse a condition deserves caution. Traditional use is not the same as demonstrated effect, and a responsible label keeps the two apart.',
          'If you are pregnant, take regular medication or have a health condition, speak to a qualified practitioner or doctor before starting any herbal product. This article is general information and not medical advice.',
        ],
      },
    ],
  },
  {
    slug: 'prakriti-a-traditional-idea',
    title: 'Prakriti: a traditional idea, not a diagnosis',
    excerpt: 'A plain introduction to Prakriti in Ayurveda, and why an online quiz cannot replace a qualified practitioner.',
    date: '2026-10-14',
    readingMinutes: 4,
    practitionerReviewed: false,
    body: [
      {
        p: [
          'In Ayurveda, Prakriti refers to an individual’s natural constitution. Classical texts describe it through three principles, Vata, Pitta and Kapha, and the idea that each person carries them in a different balance.',
        ],
      },
      {
        h: 'What the idea is for',
        p: [
          'Within the tradition, Prakriti is a way of thinking about why people differ in routine, temperament and response to food and environment. Practitioners use it alongside a detailed conversation and examination, not as a stand-alone label.',
        ],
      },
      {
        h: 'What a quiz cannot do',
        p: [
          'A short online questionnaire cannot assess Prakriti in the way a trained practitioner would, and it is not a medical assessment. We have deliberately not built one into this website.',
          'Kaayra does not offer consultations or personalised recommendations at this stage. If you want an individual assessment, please consult a qualified Ayurvedic practitioner.',
        ],
      },
      {
        h: 'A note on evidence',
        p: [
          'Prakriti is a framework from a living traditional system. It should be described as that, and not presented as a laboratory-measured category. We will say so whenever we write about it.',
        ],
      },
    ],
  },
  {
    slug: 'from-classical-text-to-formulation',
    title: 'From classical text to formulation',
    excerpt: 'The questions we ask when a classical Ayurvedic preparation is considered for a modern product.',
    date: '2026-10-14',
    readingMinutes: 5,
    practitionerReviewed: false,
    body: [
      {
        p: [
          'Classical preparations such as Triphala or Dashamoola are described in traditional texts. Turning one of them into a modern product raises practical questions that the text alone cannot answer.',
        ],
      },
      {
        h: 'Which plants, from where',
        p: [
          'Plant identity, plant part, growing region and harvest all matter. We want to know who supplies each raw material and how its identity is confirmed.',
        ],
      },
      {
        h: 'How it is prepared',
        p: [
          'Powders, decoctions and tablets behave differently. The preparation method, the form and the packaging all affect how a product is used and how long it stays stable.',
        ],
      },
      {
        h: 'What could go wrong',
        p: [
          'Safety review comes before marketing. That includes contaminants, interactions, who should not use a product and what warnings belong on the pack.',
        ],
      },
      {
        h: 'What we are allowed to say',
        p: [
          'Regulation in India governs manufacturing licences and what can be claimed. We plan to take professional regulatory advice before any product is offered, and until then we describe our products only as concepts under development.',
        ],
      },
    ],
  },
  {
    slug: 'what-is-ayurveda',
    title: 'What is Ayurveda? A plain introduction',
    excerpt: 'A short, careful introduction to Ayurveda as a traditional system of medicine from India: where it comes from, how it describes health, and what it cannot tell you about any single product.',
    date: '2026-10-26',
    readingMinutes: 4,
    practitionerReviewed: false,
    related: ['prakriti-a-traditional-idea', 'traditional-use-and-clinical-evidence', 'reading-an-ayurvedic-label'],
    body: [
      {
        p: [
          'Ayurveda is a traditional system of medicine that developed in India. The name comes from Sanskrit and is usually translated as “knowledge of life”. It is still practised today, in India and in other countries, by trained practitioners.',
        ],
      },
      {
        h: 'Where does Ayurveda come from?',
        p: [
          'Its ideas are recorded in classical Sanskrit texts. Two of the best known are the Charaka Samhita, which deals mainly with internal medicine, and the Sushruta Samhita, which deals mainly with surgery. The texts were composed over a long period, and practitioners still study and interpret them.',
        ],
      },
      {
        h: 'How does Ayurveda describe health?',
        p: [
          'Ayurveda describes health as a kind of balance. A central idea is that the body is shaped by three principles called doshas: Vata, Pitta and Kapha. Traditional practice looks at a person’s constitution, often called Prakriti, together with diet, daily routine, the season and the condition being considered.',
          'These are traditional concepts. They are a way of organising observation inside one system of practice, not laboratory measurements, and an online quiz cannot stand in for a practitioner who knows the person. Our article on Prakriti explains this in more detail.',
        ],
      },
      {
        h: 'What is an Ayurvedic preparation?',
        p: [
          'Many Ayurvedic preparations are made from plants, and some use other materials, prepared in the ways the classical texts describe. Traditionally, a practitioner chooses a preparation for a particular person. A product bought from a shelf is a different thing, which is why the plant used, the part used and how the product was made matter.',
        ],
      },
      {
        h: 'What does Ayurveda not tell you?',
        p: [
          'Traditional use describes how something has been used within a system of practice. It does not show that a particular modern product is safe, or that it works for a particular purpose. Research on Ayurvedic preparations exists, but it varies a great deal in quality and in what it can conclude. Our article on traditional use and clinical evidence shows how to tell the two kinds of statement apart.',
        ],
      },
      {
        h: 'How we use Ayurveda',
        p: [
          'Kaayra Herbals is a new company and nothing is for sale yet. We treat Ayurveda as the starting point for our questions about ingredients, not as proof of any claim.',
          'This article is general information and not medical advice. If you are thinking about any Ayurvedic treatment or product, speak to a qualified practitioner or doctor first.',
        ],
      },
    ],
  },
  {
    slug: 'how-botanical-ingredients-are-identified',
    title: 'How botanical ingredients are identified',
    excerpt: 'Why a common name is not enough, and the checks that help confirm which plant, and which part of it, is really in a herbal product.',
    date: '2026-10-26',
    readingMinutes: 5,
    practitionerReviewed: false,
    ingredients: ['brahmi', 'ashwagandha'],
    related: ['reading-an-ayurvedic-label', 'traditional-use-and-clinical-evidence', 'from-classical-text-to-formulation'],
    body: [
      {
        p: [
          'Two products can both say “Brahmi” and contain different plants. Identification is the work of confirming which plant, which part of it and what form of material a herbal ingredient really is. It is one of the least visible parts of making a herbal product, and one of the most important.',
        ],
      },
      {
        h: 'Why is the botanical name the starting point?',
        p: [
          'A botanical name has two parts, the genus and the species, for example Withania somnifera. It identifies one plant in the same way everywhere. Common names do not: the same name can be used for different plants in different regions or languages, and Sanskrit names can refer to more than one plant too. Brahmi is the standard example, because the name is applied both to Bacopa monnieri and, in some regions, to Centella asiatica.',
        ],
      },
      {
        h: 'Why does the plant part matter?',
        p: [
          'Root, leaf, fruit, bark and seed are different materials, and a label should say which one is meant. Ashwagandha is usually sold as dried root, but leaf material also exists, and the two should not be treated as the same thing.',
        ],
      },
      {
        h: 'How can the material itself be checked?',
        p: [
          'Several kinds of check are used, often together. Macroscopic examination looks at appearance, colour, smell and texture. Microscopic examination looks at the structure of cells and tissues in powdered material. Laboratory methods such as chromatographic fingerprinting, and in some cases DNA-based methods, compare a sample with a reference. No single method answers every question, and what a method can show depends on the plant and the form of the material.',
        ],
      },
      {
        h: 'What can go wrong?',
        p: [
          'Look-alike plants can be mistaken for one another, a cheaper species can be substituted for the one named, the wrong plant part can be supplied, and material can be adulterated. These are recognised problems in herbal products, which is why identity checks are done on the material and not only on the paperwork.',
        ],
      },
      {
        h: 'What should a consumer look for?',
        p: [
          'A label that gives only a common name tells you little. Look for the botanical name and the plant part. If a company publishes test information, check that it says what was tested, by which method and for which batch, because a report that does none of those things proves very little. If something is not stated, it is fair to ask the company.',
        ],
      },
      {
        h: 'How we approach it',
        p: [
          'Our ingredient library records botanical identity first and makes no health claims. Its entries are still being reviewed, and a qualified botanist or Ayurvedic practitioner should confirm each identity before any launch. We do not claim any test result, certification or approval.',
          'This article is general information and not medical advice. If you are considering any herbal product, speak to a qualified practitioner or doctor first.',
        ],
      },
    ],
  },
];

export const getArticle = (slug: string) => articles.find((a) => a.slug === slug);

export interface Ingredient {
  slug: string;
  name: string; // common / Sanskrit name
  commonName: string;
  botanical: string;
  family: string;
  part: string;
  /** Identity notes only. No health or efficacy claims. */
  note: string;
  /**
   * Optional reviewed detail. Fill a field ONLY from a source that was opened and read, or from a qualified reviewer's confirmation, and
   * never state a dose. A missing field is shown as "not written yet", never guessed.
   */
  /** Other botanical names (taxonomic synonyms) a reader may meet on labels. */
  synonyms?: string[];
  /** Sanskrit and other classical names, if different from `name`. */
  sanskrit?: string[];
  /** How the plant or material is told apart from look-alikes. */
  identification?: string;
  /** How the plant is described in traditional (Ayurvedic or related) practice. This is not clinical evidence. */
  traditionalContext?: string;
  /** What modern studies say, with the limits of that evidence, attributed to the source. */
  evidence?: string;
  /** Known safety considerations, attributed to the source. */
  safety?: string;
  /** Sources that were opened and read. */
  references?: { label: string; url: string }[];
  /** Slugs of journal articles that discuss this ingredient. */
  articles?: string[];
}

/**
 * Educational identity entries. Inclusion does NOT mean an ingredient will be used in any Kaayra product.
 * Botanical identities should be confirmed by a qualified botanist or Ayurvedic practitioner before launch.
 */
export const ingredients: Ingredient[] = [
  {
    slug: 'ashwagandha',
    name: 'Ashwagandha',
    commonName: 'Indian winter cherry',
    botanical: 'Withania somnifera (L.) Dunal',
    family: 'Solanaceae',
    part: 'Root',
    note: 'A classical Ayurvedic herb. Material is usually sold as dried root powder; the plant part matters, as leaf and root are different materials.',
    // The four fields below restate what the journal article "Traditional use and clinical evidence" already says, from the two NIH pages listed in `references`.
    traditionalContext: 'Used in Ayurvedic and Unani practice. Supplements usually contain extracts of the root, or of the root and leaf.',
    evidence: 'The US National Institutes of Health describe the research on stress, anxiety and sleep in careful terms: some preparations may help, several studies are small, and extracts might improve sleep. That is not the same as saying the plant works.',
    safety: 'The NIH Office of Dietary Supplements reports that use appears safe for up to three months, that safety over longer periods is not clear, and that ashwagandha might cause liver problems and affect how the thyroid works. It may not be suitable for people with prostate cancer or for anyone who is pregnant or breastfeeding. NCCIH also lists drowsiness and stomach upset among possible effects and advises avoiding it during pregnancy and breastfeeding. Speak to a qualified practitioner or doctor first.',
    references: [
      { label: 'National Center for Complementary and Integrative Health (NIH): Ashwagandha', url: 'https://nccih.nih.gov/health/ashwagandha' },
      { label: 'NIH Office of Dietary Supplements: Ashwagandha, is it helpful for stress, anxiety, or sleep?', url: 'https://ods.od.nih.gov/factsheets/Ashwagandha-Consumer/' },
    ],
    articles: ['traditional-use-and-clinical-evidence'],
  },
  {
    slug: 'brahmi',
    name: 'Brahmi',
    commonName: 'Water hyssop',
    botanical: 'Bacopa monnieri (L.) Wettst.',
    family: 'Plantaginaceae',
    part: 'Aerial parts',
    note: 'The name Brahmi is also applied to Centella asiatica in some regions, so the botanical name is the only reliable way to say which plant is meant.',
  },
  {
    slug: 'amalaki',
    name: 'Amalaki',
    commonName: 'Indian gooseberry, amla',
    botanical: 'Phyllanthus emblica L.',
    family: 'Phyllanthaceae',
    part: 'Fruit',
    note: 'Older texts and labels may list this plant as Emblica officinalis, a synonym. One of the three fruits in the classical preparation Triphala.',
  },
  {
    slug: 'haritaki',
    name: 'Haritaki',
    commonName: 'Chebulic myrobalan',
    botanical: 'Terminalia chebula Retz.',
    family: 'Combretaceae',
    part: 'Fruit',
    note: 'One of the three fruits in Triphala. Fruit grade and maturity vary, which is one reason supplier information matters.',
  },
  {
    slug: 'bibhitaki',
    name: 'Bibhitaki',
    commonName: 'Beleric myrobalan',
    botanical: 'Terminalia bellerica (Gaertn.) Roxb.',
    family: 'Combretaceae',
    part: 'Fruit',
    note: 'One of the three fruits in Triphala. Closely related to Haritaki but a different species.',
  },
  {
    slug: 'guduchi',
    name: 'Guduchi',
    commonName: 'Heart-leaved moonseed, giloy',
    botanical: 'Tinospora cordifolia (Willd.) Hook.f. & Thomson',
    family: 'Menispermaceae',
    part: 'Stem',
    note: 'Often sold as giloy. Look-alike Tinospora species exist, so identity confirmation is important.',
  },
  {
    slug: 'tulsi',
    name: 'Tulsi',
    commonName: 'Holy basil',
    botanical: 'Ocimum tenuiflorum L.',
    family: 'Lamiaceae',
    part: 'Leaf',
    note: 'Also written Ocimum sanctum. Several tulsi varieties are grown, which differ in appearance and aroma.',
  },
  {
    slug: 'punarnava',
    name: 'Punarnava',
    commonName: 'Spreading hogweed',
    botanical: 'Boerhavia diffusa L.',
    family: 'Nyctaginaceae',
    part: 'Root',
    note: 'The name Punarnava is applied to more than one plant in different regions, so botanical identification is essential.',
  },
];

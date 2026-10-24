export interface Ingredient {
  slug: string;
  name: string; // common / Sanskrit name
  commonName: string;
  botanical: string;
  family: string;
  part: string;
  /** Identity notes only. No health or efficacy claims. */
  note: string;
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

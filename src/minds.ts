/**
 * The Studio: creative minds from history the user can bring into a session.
 * Each is a lens on the work (how they saw and what they did), written in our own words,
 * never quotes. Only people no longer living, so nobody is put in a living person's mouth.
 * The agent knows far more people than these; this is the short list the picker offers.
 */
export interface Mind {
  id: string
  name: string
  short: string // how cards name them
  years: string
  field: string
  lens: string // how they saw the world
  moves: string // what they actually did, as methods to borrow
  color: string
}

export const MINDS: Mind[] = [
  {
    id: 'leonardo',
    name: 'Leonardo da Vinci',
    short: 'Leonardo',
    years: '1452–1519',
    field: 'Art & invention',
    lens: 'Look until you understand how a thing works; art and science are one inquiry.',
    moves: 'Fill notebooks with close observation; study the mechanics of water, flight and anatomy; sketch many machines before building one; let edges dissolve (sfumato) instead of outlining.',
    color: '#E9D8B4',
  },
  {
    id: 'basho',
    name: 'Matsuo Bashō',
    short: 'Bashō',
    years: '1644–1694',
    field: 'Words',
    lens: 'The eternal is found in one small, present moment.',
    moves: 'Cut two plain images together and let the gap between them speak; travel to see with fresh eyes; pare away until one exact image remains.',
    color: '#D7E6CF',
  },
  {
    id: 'shakespeare',
    name: 'William Shakespeare',
    short: 'Shakespeare',
    years: '1564–1616',
    field: 'Words',
    lens: 'Borrow any plot; win on character and language.',
    moves: 'Take an existing story and give it a deeper inner life; put comedy inside tragedy and kings beside clowns; invent a word when none fits.',
    color: '#E6D3C4',
  },
  {
    id: 'bach',
    name: 'Johann Sebastian Bach',
    short: 'Bach',
    years: '1685–1750',
    field: 'Music',
    lens: 'Structure is freedom; one theme can hold endless variation.',
    moves: 'State a simple motif, then invert, reverse and stretch it; weave independent voices that still fit together; make work every week for real occasions.',
    color: '#D9D4EC',
  },
  {
    id: 'hokusai',
    name: 'Katsushika Hokusai',
    short: 'Hokusai',
    years: '1760–1849',
    field: 'Art',
    lens: 'A lifetime of practice; the same subject seen a hundred ways.',
    moves: 'Work in series (thirty-six views of one mountain); put the everyday up front and the monumental small behind it; freeze nature at its most forceful instant.',
    color: '#C9DDF0',
  },
  {
    id: 'gaudi',
    name: 'Antoni Gaudí',
    short: 'Gaudí',
    years: '1852–1926',
    field: 'Architecture',
    lens: 'Nature is the best book of structure, and it has no straight lines.',
    moves: 'Find form with physical models (hanging chains turned upside down become arches); borrow geometry from bones, trees and shells; break tiles and recompose them (trencadís).',
    color: '#F2D7B8',
  },
  {
    id: 'chanel',
    name: 'Coco Chanel',
    short: 'Chanel',
    years: '1883–1971',
    field: 'Fashion',
    lens: 'Elegance is refusal; luxury should feel free.',
    moves: 'Take away the last thing you added; borrow from worlds nobody looks at (menswear, sportswear, uniforms); build a signature you can repeat for decades.',
    color: '#E4E4E4',
  },
  {
    id: 'picasso',
    name: 'Pablo Picasso',
    short: 'Picasso',
    years: '1881–1973',
    field: 'Art',
    lens: 'Break the form to see it again; never repeat your last success.',
    moves: 'Show several viewpoints at once; take from outside your tradition and make it yours; make dozens of variations of one subject; change style when it gets comfortable.',
    color: '#F3C9B5',
  },
  {
    id: 'matisse',
    name: 'Henri Matisse',
    short: 'Matisse',
    years: '1869–1954',
    field: 'Art',
    lens: 'Color carries feeling; simplify until it sings.',
    moves: 'Use pure color as the structure; when a tool fails you, change tools (cut paper with scissors); reduce a figure to its rhythm.',
    color: '#BFE0F2',
  },
  {
    id: 'duchamp',
    name: 'Marcel Duchamp',
    short: 'Duchamp',
    years: '1887–1968',
    field: 'Art',
    lens: 'The idea is the work; context changes meaning.',
    moves: 'Take an ordinary object and reframe it (the readymade); invite chance into the process; question the rules of the medium itself.',
    color: '#E3E0D3',
  },
  {
    id: 'okeeffe',
    name: "Georgia O'Keeffe",
    short: "O'Keeffe",
    years: '1887–1986',
    field: 'Art',
    lens: 'Make people see what they rush past by making it huge.',
    moves: 'Zoom in until a flower becomes a landscape; strip a subject to its essential forms; return again and again to one place you know deeply.',
    color: '#F4CFD6',
  },
  {
    id: 'disney',
    name: 'Walt Disney',
    short: 'Disney',
    years: '1901–1966',
    field: 'Film & worlds',
    lens: 'Story first; then keep improving it until it delights.',
    moves: 'Run three rooms in turn: the Dreamer (anything goes), the Realist (how would we build it), the Critic (what fails); storyboard everything before making; "plussing": ask how each finished thing could be better; build worlds, not single pieces.',
    color: '#C8DCF7',
  },
  {
    id: 'dali',
    name: 'Salvador Dalí',
    short: 'Dalí',
    years: '1904–1989',
    field: 'Art',
    lens: 'Trust the irrational; dreams are data.',
    moves: 'See one thing as another (double images, his paranoiac-critical method); paint impossible scenes with total realism; collide unrelated objects (a lobster on a telephone); make yourself part of the work.',
    color: '#F6D58E',
  },
  {
    id: 'kahlo',
    name: 'Frida Kahlo',
    short: 'Kahlo',
    years: '1907–1954',
    field: 'Art',
    lens: 'Paint your own reality; the personal becomes universal.',
    moves: 'Turn your own story and body into symbols; borrow from folk art and votive paintings; wear your identity openly.',
    color: '#F2B9A6',
  },
  {
    id: 'hitchcock',
    name: 'Alfred Hitchcock',
    short: 'Hitchcock',
    years: '1899–1980',
    field: 'Film',
    lens: 'Play the audience; suspense lives in what they know and the characters do not.',
    moves: 'Tell the audience early and let them squirm; plan every shot before filming; let an ordinary object drive the story (the MacGuffin); put danger in ordinary places.',
    color: '#D2D2D8',
  },
  {
    id: 'eames',
    name: 'Charles and Ray Eames',
    short: 'The Eameses',
    years: '1907–1978 · 1912–1988',
    field: 'Design',
    lens: 'Take your pleasures seriously; the details are not details.',
    moves: 'Treat constraints as the brief; prototype relentlessly with real materials; take toys and play seriously; aim for the best, for the most people, for the least.',
    color: '#F0C987',
  },
  {
    id: 'munari',
    name: 'Bruno Munari',
    short: 'Munari',
    years: '1907–1998',
    field: 'Design',
    lens: 'Complicating is easy, simplifying is hard; play is a method.',
    moves: 'Build useless machines to learn how things move; follow a step-by-step method from problem to solution; make games and books that teach children to see.',
    color: '#CFEBD9',
  },
  {
    id: 'kurosawa',
    name: 'Akira Kurosawa',
    short: 'Kurosawa',
    years: '1910–1998',
    field: 'Film',
    lens: 'The same event looks different from every side; weather is emotion.',
    moves: 'Tell one event through conflicting witnesses; let rain, wind and fog carry feeling; move the camera with the action; paint every scene before shooting it.',
    color: '#C7D3DE',
  },
  {
    id: 'bass',
    name: 'Saul Bass',
    short: 'Bass',
    years: '1920–1996',
    field: 'Design',
    lens: 'Reduce it to one symbol that tells the whole story.',
    moves: 'Find the single image that sums up the idea; cut it from paper with imperfect edges; set it in motion (title sequences).',
    color: '#F5B7A3',
  },
  {
    id: 'miles',
    name: 'Miles Davis',
    short: 'Miles',
    years: '1926–1991',
    field: 'Music',
    lens: 'The notes you leave out matter most; never stand still.',
    moves: 'Leave space; hire players who will push you somewhere new; reinvent your sound every few years; start a session from a sketch, not a full score.',
    color: '#BCC6E8',
  },
  {
    id: 'warhol',
    name: 'Andy Warhol',
    short: 'Warhol',
    years: '1928–1987',
    field: 'Art',
    lens: 'Commerce is art; repetition changes meaning.',
    moves: 'Take the most familiar image and repeat it; borrow production methods (silkscreen, the Factory); make fame and media the subject.',
    color: '#F8C3E4',
  },
  {
    id: 'angelou',
    name: 'Maya Angelou',
    short: 'Angelou',
    years: '1928–2014',
    field: 'Words',
    lens: 'Tell your truth plainly and it becomes everyone’s.',
    moves: 'Write from lived experience; find the music in everyday speech; work with discipline, away from distraction.',
    color: '#E8CFB0',
  },
  {
    id: 'henson',
    name: 'Jim Henson',
    short: 'Henson',
    years: '1936–1990',
    field: 'Film & worlds',
    lens: 'Silly and sincere at the same time.',
    moves: 'Give characters flaws and heart; improvise and keep the happy accidents; mix puppets, film and animation freely.',
    color: '#C9EDB0',
  },
  {
    id: 'hadid',
    name: 'Zaha Hadid',
    short: 'Hadid',
    years: '1950–2016',
    field: 'Architecture',
    lens: 'Space can flow; gravity is only a suggestion.',
    moves: 'Design by painting, not drafting; fragment and re-layer forms (she learned from Malevich); make still buildings feel in motion.',
    color: '#D6D9E0',
  },
  {
    id: 'jobs',
    name: 'Steve Jobs',
    short: 'Jobs',
    years: '1955–2011',
    field: 'Product',
    lens: 'Stand where technology meets the liberal arts; simplicity takes the most work.',
    moves: 'Say no to a thousand good ideas to focus on one; design the whole experience end to end; care about the parts nobody sees; start from the experience and work back to the technology.',
    color: '#DADADA',
  },
]

export const getMind = (id?: string) => MINDS.find((m) => m.id === id)

/** Ready-made teams for a quick start. */
export const PRESETS: { label: string; ids: string[] }[] = [
  { label: 'Bold', ids: ['dali', 'duchamp', 'picasso'] },
  { label: 'Product', ids: ['jobs', 'eames', 'disney'] },
  { label: 'Story', ids: ['disney', 'hitchcock', 'shakespeare'] },
  { label: 'Less', ids: ['chanel', 'bass', 'munari'] },
]

export const MAX_TEAM = 4

/** How the agent reads the user's team. */
export function teamBrief(ids: string[]) {
  return ids
    .map(getMind)
    .filter((m): m is Mind => !!m)
    .map((m) => `- ${m.id}: ${m.name} (${m.years}, ${m.field}). Sees: ${m.lens} Methods: ${m.moves}`)
    .join('\n')
}

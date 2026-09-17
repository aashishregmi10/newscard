import 'dotenv/config';
import { ObjectId } from 'mongodb';
import { connect, close, collections } from '@saar/db';
import { countGraphemes, countWords } from '@saar/shared';

/**
 * Stories in the editorial queue, so the newsroom workflow can be demonstrated.
 *
 * ── Why this is needed ──────────────────────────────────────────────────────
 *
 * The demonstration corpus seeds 56 stories and publishes all of them. That is
 * right for the reader app — a full feed in every section — and it leaves the
 * CMS with an empty queue, so the half of the product the client is buying for
 * their newsroom cannot be shown at all. There is nothing to review, nothing to
 * approve, nothing to publish live in front of them.
 *
 * This puts work at every stage of the workflow:
 *
 *   draft       one still being written, and one with no image, so the
 *               composer's image attachment has somewhere to be demonstrated
 *   in_review   waiting on a reviewer, which is where the role rules show
 *   approved    ready to publish — the button that actually does something
 *
 * It also seeds one CLUSTER: the same event filed by three publishers, which is
 * what the duplicate flag and the cluster panel exist for and cannot otherwise
 * be shown.
 *
 * ── The content rules, unchanged from the main seed ─────────────────────────
 *
 *   • Publishers are invented. Never a real outlet.
 *   • No real, named private individual, and no quote attributed to one.
 *   • Nothing states a checkable fact about a real institution — no index
 *     levels, no budget figures, no match results.
 *
 * Invented numbers make a demo look sharper and make it a fabricated record.
 *
 * Idempotent: it removes anything it seeded before, so it can be re-run between
 * rehearsals to put the queue back.
 *
 * Run: npm run demo:seed
 */

const MARKER = 'queue-demo-';

interface QueueStory {
  slug: string;
  language: 'ne' | 'en';
  category: string;
  source: string;
  status: 'draft' | 'in_review' | 'approved';
  headline: string;
  summary: string;
  pullQuote?: string | null;
  /** Shares an event with other entries carrying the same key. */
  clusterKey?: string;
  noImage?: boolean;
  possibleDuplicate?: boolean;
  editorialNotes?: string | null;
}

const STORIES: QueueStory[] = [
  /* ── one event, three publishers: the cluster demo ─────────────────────── */
  {
    slug: `${MARKER}ne-monsoon-roadworks-a`,
    language: 'ne',
    category: 'nepal',
    source: 'namuna-khabar',
    status: 'in_review',
    clusterKey: 'roadworks',
    possibleDuplicate: true,
    headline: 'वर्षापछि सडक मर्मतको काम तीव्र',
    summary:
      'वर्षा थामिएपछि सहरका मुख्य सडकमा मर्मतको काम तीव्र भएको छ। पानी जम्ने खण्डमा ढल सफा गर्ने र खाल्डा पुर्ने काम सँगै अघि बढाइएको सम्बन्धित कार्यालयले जनाएको छ। काम चलिरहेका बेला दिउँसोको समयमा एकतर्फी सवारी सञ्चालन हुने भएको छ। बिहान र साँझको व्यस्त समयमा भने दुवैतर्फ खुला राखिनेछ। मर्मत सकिएपछि पानीको बहाव सहज हुने अपेक्षा गरिएको छ।',
    pullQuote: 'पानी जम्ने खण्डमा ढल सफा गर्ने काम सँगै अघि बढाइएको छ।',
  },
  {
    slug: `${MARKER}ne-monsoon-roadworks-b`,
    language: 'ne',
    category: 'nepal',
    source: 'namuna-samachar',
    status: 'in_review',
    clusterKey: 'roadworks',
    possibleDuplicate: true,
    headline: 'सडक मर्मत सुरु, दिउँसो एकतर्फी सवारी',
    summary:
      'सहरभित्रका सडकमा मर्मत सुरु भएको छ। काम भइरहेको खण्डमा दिउँसोको समयमा एकतर्फी सवारी सञ्चालन गरिने भएको छ। बिहान र साँझको व्यस्त समयमा भने दुवैतर्फ खुला राखिने जनाइएको छ। सवारीचालकलाई वैकल्पिक बाटो प्रयोग गर्न आग्रह गरिएको छ। मर्मत भइरहेको खण्डमा सूचना पाटी राखिने र राति काम नहुने सम्बन्धित कार्यालयले जनाएको छ।',
    pullQuote: null,
  },
  {
    slug: `${MARKER}en-monsoon-roadworks-c`,
    language: 'en',
    category: 'nepal',
    source: 'sample-post',
    status: 'draft',
    clusterKey: 'roadworks',
    possibleDuplicate: true,
    headline: 'Road repairs resume as the rain eases',
    summary:
      'Repair work on main roads has picked up now that the rain has eased, with drain clearing and resurfacing running together on the stretches that flood. Traffic will run one way through the working sections during the middle of the day, and both ways at the busiest morning and evening hours.',
    pullQuote: null,
  },

  /* ── ready to publish, live, in front of the client ────────────────────── */
  {
    slug: `${MARKER}ne-school-term-calendar`,
    language: 'ne',
    category: 'nepal',
    source: 'namuna-khabar',
    status: 'approved',
    headline: 'नयाँ शैक्षिक सत्रको तयारी सुरु',
    summary:
      'नयाँ शैक्षिक सत्रको तयारी सुरु भएको छ। विद्यालयहरूले पाठ्यसामग्री व्यवस्थापन र शिक्षक तालिमको कार्यतालिका बनाउन थालेका छन्। भर्ना अभियान सुरु हुनुअघि नै तयारी पूरा गर्ने लक्ष्य रहेको सम्बन्धित कार्यालयले जनाएको छ। अभिभावकलाई आवश्यक कागजात पहिल्यै तयार राख्न सुझाव दिइएको छ। दुर्गम क्षेत्रका विद्यालयमा सामग्री ढुवानी मौसमका कारण ढिलो हुन सक्ने भन्दै त्यसको छुट्टै योजना बनाइएको जनाइएको छ।',
    pullQuote: 'भर्ना अभियान सुरु हुनुअघि तयारी पूरा गर्ने लक्ष्य छ।',
  },
  {
    slug: `${MARKER}en-trail-season-opens`,
    language: 'en',
    category: 'sports',
    source: 'sample-post',
    status: 'approved',
    headline: 'Trekking routes reopen for the autumn season',
    summary:
      'Trekking routes are reopening for the autumn season now that the monsoon has passed, with teahouses along the main trails taking bookings again. Operators say the first arrivals are expected within weeks, and are asking walkers to register their route before setting out so that anyone overdue can be found quickly.',
    pullQuote: null,
  },

  /* ── still being written: where the composer is demonstrated ───────────── */
  {
    slug: `${MARKER}ne-market-morning-draft`,
    language: 'ne',
    category: 'business',
    source: 'namuna-samachar',
    status: 'draft',
    noImage: true,
    editorialNotes: 'तस्बिर बाँकी — फोटो पत्रकारसँग सम्पर्क गर्नुपर्ने।',
    headline: 'बिहानी बजारमा चहलपहल बढ्यो',
    summary:
      'चाडपर्व नजिकिँदै गर्दा बिहानी बजारमा चहलपहल बढेको छ। व्यापारीहरूले तरकारी र फलफूलको आपूर्ति सहज रहेको बताएका छन्। बजार व्यवस्थापनका लागि थप सफाइ कर्मचारी खटाइएको छ।',
    pullQuote: null,
  },
  {
    slug: `${MARKER}en-power-line-upgrade-draft`,
    language: 'en',
    category: 'tech',
    source: 'sample-tech',
    status: 'draft',
    headline: 'Ridge villages reconnected after line work',
    summary:
      'Villages along the ridge are back on the grid after work on the distribution line, which had been interrupted through the wettest weeks. Crews are continuing along the route, and residents have been asked to report outages rather than assume the work is still in progress.',
    pullQuote: null,
  },
];

async function main(): Promise<void> {
  const db = await connect({ uri: process.env.MONGO_URI! });
  const c = collections(db);

  // Idempotent: clear anything a previous run left, so rehearsing twice does
  // not accumulate a queue nobody meant to have.
  const removed = await c.articles.deleteMany({ slug: { $regex: `^${MARKER}` } });
  if (removed.deletedCount > 0) {
    console.log(`  cleared ${removed.deletedCount} story/stories from a previous run`);
  }

  const editor = await c.staff.findOne({ isActive: true });
  if (!editor) {
    console.error('No active staff account. Run: npm run db:seed');
    process.exit(1);
  }

  const categories = new Map(
    (await c.categories.find({}).toArray()).map((x) => [x.slug, x] as const),
  );
  const sources = new Map((await c.sources.find({}).toArray()).map((x) => [x.slug, x] as const));

  // Reuse images already on disk rather than generating more: the point is a
  // queue to work through, not new media.
  const withImages = await c.articles
    .find({ status: 'published', image: { $ne: null } })
    .limit(STORIES.length)
    .toArray();

  const clusterIds = new Map<string, ObjectId>();
  const now = Date.now();
  let imageIdx = 0;

  const docs = STORIES.map((s, i) => {
    const category = categories.get(s.category);
    const source = sources.get(s.source);
    if (!category || !source) {
      throw new Error(`Unknown category/source for ${s.slug}: ${s.category} / ${s.source}`);
    }

    let clusterId: ObjectId | null = null;
    if (s.clusterKey) {
      if (!clusterIds.has(s.clusterKey)) clusterIds.set(s.clusterKey, new ObjectId());
      clusterId = clusterIds.get(s.clusterKey)!;
    }

    const image = s.noImage ? null : (withImages[imageIdx++]?.image ?? null);
    const created = new Date(now - (STORIES.length - i) * 23 * 60_000);

    return {
      _id: new ObjectId(),
      slug: s.slug,
      status: s.status,
      language: s.language,
      categoryId: category._id,
      sourceId: source._id,
      publishedAt: null,
      headline: s.headline,
      summary: s.summary,
      summaryWordCount: countWords(s.summary),
      summaryCharCount: countGraphemes(s.summary),
      pullQuote: s.pullQuote ?? null,
      // Unique per story: `publisher_url_unique` is an index, and two stories
      // pointing at the same page is exactly the duplicate it exists to catch.
      publisherUrl: `${source.homepageUrl}/${s.slug}`,
      publisherAuthor: null,
      publisherPublishedAt: created,
      tags: [],
      clusterId,
      originatingAgency: null,
      image,
      sourceName: source.displayName,
      sourceLogoUrl: source.logoUrl ?? null,
      categorySlug: category.slug,
      categoryLabel: category.label,
      authoredBy: editor._id,
      // An approved story must carry its reviewer, or the publish precondition
      // has nothing to check against.
      reviewedBy: s.status === 'approved' ? editor._id : null,
      selfApproved: s.status === 'approved',
      editorialNotes: s.editorialNotes ?? null,
      draftSource: 'human',
      revisionCount: 0,
      possibleDuplicate: s.possibleDuplicate ?? false,
      possibleLanguageMismatch: false,
      createdAt: created,
      updatedAt: created,
    };
  });

  /**
   * A story that cannot be submitted is a demo that stalls.
   *
   * The summary limit is enforced at submission, so a seeded `in_review` or
   * `approved` story whose summary is outside it leaves the reviewer staring at
   * a disabled button in front of the client. Drafts are exempt — a short draft
   * is realistic, and it is what makes the live counter worth showing.
   *
   * Checked here rather than trusted, because this went wrong once: every
   * summary written for this file was a plausible paragraph and four of the
   * seven were under the minimum.
   */
  const cfg = await c.config.findOne({});
  const limits = cfg?.summaryLimits?.limits;
  if (limits) {
    const unsubmittable = docs
      .filter((d) => d.status !== 'draft')
      .map((d) => ({ d, w: countWords(d.summary) }))
      .filter(({ d, w }) => {
        const l = limits[d.language as 'ne' | 'en'];
        return !l || w < l.min || w > l.max;
      });

    if (unsubmittable.length > 0) {
      console.error('\nThese would be seeded in a state they cannot leave:\n');
      for (const { d, w } of unsubmittable) {
        const l = limits[d.language as 'ne' | 'en']!;
        console.error(`  ${d.status.padEnd(10)} ${w} words (needs ${l.min}–${l.max})  ${d.headline}`);
      }
      console.error('\nFix the summaries in this file and run it again.\n');
      process.exit(1);
    }
  }

  await c.articles.insertMany(docs as never);

  const byStatus = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n  seeded ${docs.length} stories into the editorial queue`);
  for (const [status, n] of Object.entries(byStatus)) console.log(`    ${status.padEnd(10)} ${n}`);
  console.log(`    ${clusterIds.size} cluster — one event filed by three publishers`);
  console.log(`\n  The queue is at http://localhost:5173 — sign in and work through it.\n`);

  await close();
}

main().catch(async (e) => {
  console.error(e);
  await close();
  process.exit(1);
});

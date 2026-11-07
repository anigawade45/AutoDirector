import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { CatalogModel } from '../models/Catalog.js';
import { ProjectModel } from '../models/Project.js';
import { TimelineModel } from '../models/Timeline.js';
import { TimelineVersionModel } from '../models/TimelineVersion.js';
import { RenderJobModel } from '../models/RenderJob.js';
import { UserModel } from '../models/User.js';
import mongoose from 'mongoose';

async function initDatabaseSchemaAndIndexes() {
  console.log('[Init] Connecting to MongoDB...');
  await connectDatabase();
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error('Database connection not established');
  }

  console.log('[Init] Ensuring collections exist...');
  const existingColls = (await db.listCollections().toArray()).map((c) => c.name);
  if (!existingColls.includes('timelines')) {
    await db.createCollection('timelines');
  }

  // 1. Apply Server-side $jsonSchema Validator on 'timelines' (Database Blueprint Section 13)
  console.log('[Init] Applying $jsonSchema validation rules on timelines collection...');
  try {
    await db.command({
      collMod: 'timelines',
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['projectId', 'userId', 'rev', 'version', 'fps', 'tracks'],
          properties: {
            rev: { bsonType: 'int', minimum: 0 },
            fps: { enum: [24, 25, 30, 60] },
            tracks: {
              bsonType: 'array',
              maxItems: 12,
              items: {
                bsonType: 'object',
                required: ['id', 'kind', 'clips'],
                properties: {
                  kind: {
                    enum: ['video', 'audio', 'music', 'subtitle', 'text', 'overlay'],
                  },
                  clips: { bsonType: 'array', maxItems: 2000 },
                },
              },
            },
          },
        },
      },
      validationLevel: 'moderate',
      validationAction: 'error',
    });
    console.log('[Init] $jsonSchema validator applied successfully.');
  } catch (err: any) {
    console.warn('[Init] Note on collMod validator:', err.message);
  }

  // 2. Synchronize Model Indexes
  console.log('[Init] Synchronizing Mongoose indexes...');
  await Promise.all([
    UserModel.syncIndexes(),
    ProjectModel.syncIndexes(),
    TimelineModel.syncIndexes(),
    TimelineVersionModel.syncIndexes(),
    RenderJobModel.syncIndexes(),
    CatalogModel.syncIndexes(),
  ]);

  // 3. Seed Default Catalog Entries (Templates, LUTs, Music)
  console.log('[Init] Seeding default platform catalog assets...');
  const catalogSeeds = [
    {
      kind: 'template',
      key: 'tpl_cinematic',
      name: 'Cinematic Title Hook',
      tags: ['intro', 'cinematic', 'minimal'],
      s3Key: 'library/templates/tpl_cinematic.json',
      meta: { defaultDurationSec: 5, theme: '#FFD84D' },
      license: { name: 'Platform License', attributionRequired: false },
      active: true,
    },
    {
      kind: 'lut',
      key: 'teal_orange',
      name: 'Teal & Orange Grade',
      tags: ['lut', 'color', 'cinematic'],
      s3Key: 'library/luts/teal_orange.cube',
      meta: { contrast: 1.15, saturation: 0.9 },
      license: { name: 'CC0', attributionRequired: false },
      active: true,
    },
    {
      kind: 'lut',
      key: 'golden_hour',
      name: 'Golden Hour Warmth',
      tags: ['lut', 'warm', 'sunset'],
      s3Key: 'library/luts/golden_hour.cube',
      meta: { contrast: 1.05, saturation: 1.15 },
      license: { name: 'CC0', attributionRequired: false },
      active: true,
    },
    {
      kind: 'music',
      key: 'mus_calm_01',
      name: 'Calm Cinematic Ambient',
      tags: ['music', 'calm', 'ambient', 'vlog'],
      s3Key: 'library/music/mus_calm_01.mp3',
      meta: { bpm: 96, mood: 'calm', durationMs: 120000 },
      license: { name: 'Royalty-Free Platform Music', attributionRequired: false },
      active: true,
    },
    {
      kind: 'music',
      key: 'mus_upbeat_01',
      name: 'Upbeat Creator Energy',
      tags: ['music', 'upbeat', 'fast', 'reels'],
      s3Key: 'library/music/mus_upbeat_01.mp3',
      meta: { bpm: 128, mood: 'upbeat', durationMs: 90000 },
      license: { name: 'Royalty-Free Platform Music', attributionRequired: false },
      active: true,
    },
  ];

  for (const item of catalogSeeds) {
    await CatalogModel.updateOne({ key: item.key }, { $set: item }, { upsert: true });
  }

  console.log('[Init] Default catalog assets seeded successfully.');
  await disconnectDatabase();
  console.log('[Init] Done!');
}

initDatabaseSchemaAndIndexes().catch((err) => {
  console.error('[Init] Error initializing schema & indexes:', err);
  process.exit(1);
});

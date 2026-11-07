import mongoose, { Schema, Document } from 'mongoose';

export type CatalogKind = 'template' | 'lut' | 'font' | 'music' | 'overlay';

export interface ICatalogDocument extends Document {
  kind: CatalogKind;
  key: string;
  name: string;
  tags: string[];
  s3Key: string;
  meta: Record<string, unknown>;
  license: {
    name: string;
    attributionRequired: boolean;
    url?: string;
  };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CatalogSchema = new Schema<ICatalogDocument>(
  {
    kind: {
      type: String,
      enum: ['template', 'lut', 'font', 'music', 'overlay'],
      required: true,
    },
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    tags: [{ type: String }],
    s3Key: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
    license: {
      name: { type: String, default: 'Standard' },
      attributionRequired: { type: Boolean, default: false },
      url: { type: String },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CatalogSchema.index({ kind: 1, active: 1, tags: 1 });

export const CatalogModel = mongoose.model<ICatalogDocument>('Catalog', CatalogSchema);


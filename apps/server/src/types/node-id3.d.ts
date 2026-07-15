declare module "node-id3" {
  export interface Tags {
    title?: string;
    artist?: string;
    album?: string;
    comment?: { language?: string; text: string };
    image?: {
      mime: string;
      type: { id: number; name?: string };
      description?: string;
      imageBuffer: Buffer;
    };
    www?: string;
    userDefinedUrl?: Array<{ description: string; url: string }>;
    [key: string]: unknown;
  }

  export function write(
    tags: Tags,
    filePath: string | Buffer,
  ): true | Error | string;
  export function read(filePath: string | Buffer): Tags;
  export function update(
    tags: Tags,
    filePath: string | Buffer,
  ): true | Error | string;
  export function create(tags: Tags): Buffer;

  const NodeID3: {
    write: typeof write;
    read: typeof read;
    update: typeof update;
    create: typeof create;
  };
  export default NodeID3;
}

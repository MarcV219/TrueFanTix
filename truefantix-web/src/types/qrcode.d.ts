declare module 'qrcode' {
  export function toBuffer(
    text: string,
    options?: {
      type?: 'png' | 'svg' | 'terminal' | 'utf8';
      width?: number;
      margin?: number;
      color?: {
        dark?: string;
        light?: string;
      };
    }
  ): Promise<Buffer>;

  export function toString(
    text: string,
    options?: {
      type?: 'png' | 'svg' | 'terminal' | 'utf8';
      width?: number;
      margin?: number;
    }
  ): Promise<string>;

  export function toDataURL(
    text: string,
    options?: {
      type?: 'image/png' | 'image/jpeg';
      width?: number;
      margin?: number;
      color?: {
        dark?: string;
        light?: string;
      };
    }
  ): Promise<string>;
}

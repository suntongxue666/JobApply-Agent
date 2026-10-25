declare module "mammoth/mammoth.browser" {
  const mammoth: {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string }>;
  };
  export default mammoth;
}
declare module "*.pdf" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.docx" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.txt" {
  const text: string;
  export default text;
}

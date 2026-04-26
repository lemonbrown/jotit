export function isDocxFile(fileName) {
  return fileName.toLowerCase().endsWith('.docx')
}

export async function parseDocxToText(file) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const { value } = await mammoth.extractRawText({ arrayBuffer })
  return value
}

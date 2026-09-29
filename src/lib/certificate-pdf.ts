type CertificatePdfInput = {
  completionDate: Date;
  courseTitle: string;
  studentName: string;
  verificationCode: string;
};

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function textLine({
  align = 'left',
  color = '1 1 1',
  font = 'F1',
  size,
  text,
  x,
  y,
}: {
  align?: 'center' | 'left';
  color?: string;
  font?: 'F1' | 'F2';
  size: number;
  text: string;
  x: number;
  y: number;
}) {
  const escaped = escapePdfText(text);
  const tx =
    align === 'center'
      ? `${x} ${y} Td (${escaped}) Tj`
      : `${x} ${y} Td (${escaped}) Tj`;

  return `BT /${font} ${size} Tf ${color} rg ${tx} ET`;
}

function fitText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

export function generateCertificatePdf({
  completionDate,
  courseTitle,
  studentName,
  verificationCode,
}: CertificatePdfInput) {
  const issuedDate = new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(completionDate);
  const content = [
    '0.071 0.082 0.110 rg 0 0 842 595 re f',
    '0.788 0.631 0.353 rg 52 52 738 491 re S',
    '0.788 0.631 0.353 rg 88 454 666 2 re f',
    textLine({
      color: '0.788 0.631 0.353',
      font: 'F2',
      size: 18,
      text: 'Certificate of completion',
      x: 88,
      y: 492,
    }),
    textLine({
      color: '0.949 0.937 0.906',
      font: 'F2',
      size: 38,
      text: fitText(studentName, 42),
      x: 88,
      y: 382,
    }),
    textLine({
      color: '0.545 0.553 0.596',
      size: 13,
      text: 'has successfully completed',
      x: 88,
      y: 346,
    }),
    textLine({
      color: '0.949 0.937 0.906',
      font: 'F2',
      size: 28,
      text: fitText(courseTitle, 54),
      x: 88,
      y: 304,
    }),
    textLine({
      color: '0.545 0.553 0.596',
      size: 12,
      text: `Completion date: ${issuedDate}`,
      x: 88,
      y: 224,
    }),
    textLine({
      color: '0.788 0.631 0.353',
      size: 12,
      text: `Verification code: ${verificationCode}`,
      x: 88,
      y: 198,
    }),
    textLine({
      color: '0.545 0.553 0.596',
      size: 10,
      text: 'LMS certificate record',
      x: 88,
      y: 118,
    }),
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

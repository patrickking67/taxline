// Form layouts the rules extractor understands.
//
// Each form lists its fields, the captions that anchor them in the two text
// layouts the repo generates (the IRS form captions and a payroll-style summary),
// and whether the field is reported or only read to cross-check a reported one.
// This file has no imports so the evaluation script can load it without the
// service's dependencies.

export type FieldKind = 'money' | 'id' | 'text' | 'code';

export interface FieldSpec {
  /** Stable key used by the cross-field checks. */
  key: string;
  /** Label in the output; matches the intake queue and the evaluation truth. */
  label: string;
  kind: FieldKind;
  /** Captions that introduce the value, most specific first. */
  anchors: string[];
  /** Support fields are read for the checks and never reported. */
  support?: boolean;
}

export interface FormSpec {
  docType: string;
  /** Words that identify the form in a title line. */
  titleKeys: string[];
  fields: FieldSpec[];
}

export const W2: FormSpec = {
  docType: 'W-2',
  titleKeys: ['Form W-2', 'Wage and Tax Statement'],
  fields: [
    {
      key: 'name',
      label: 'Employer',
      kind: 'text',
      anchors: ["c Employer's name, address, and ZIP code", 'Employer'],
    },
    {
      key: 'ein',
      label: 'EIN',
      kind: 'id',
      anchors: ['b Employer identification number (EIN)', 'Employer ID (EIN)'],
    },
    {
      key: 'box1',
      label: 'Wages · box 1',
      kind: 'money',
      anchors: ['1 Wages, tips, other compensation', 'Box 1 Wages'],
    },
    {
      key: 'box2',
      label: 'Federal w/h · box 2',
      kind: 'money',
      anchors: ['2 Federal income tax withheld', 'Box 2 Federal tax withheld'],
    },
    {
      key: 'box3',
      label: 'Social security wages · box 3',
      kind: 'money',
      anchors: ['3 Social security wages', 'Box 3 Social security wages'],
      support: true,
    },
    {
      key: 'box4',
      label: 'Social security tax · box 4',
      kind: 'money',
      anchors: ['4 Social security tax withheld', 'Box 4 Social security tax'],
      support: true,
    },
    {
      key: 'box5',
      label: 'Medicare wages · box 5',
      kind: 'money',
      anchors: ['5 Medicare wages and tips', 'Box 5 Medicare wages'],
      support: true,
    },
    {
      key: 'box6',
      label: 'Medicare tax · box 6',
      kind: 'money',
      anchors: ['6 Medicare tax withheld', 'Box 6 Medicare tax'],
      support: true,
    },
    {
      key: 'box12d',
      label: 'Elective deferrals · box 12a code D',
      kind: 'money',
      anchors: ['12a Code D', 'Box 12a Code D'],
      support: true,
    },
    {
      key: 'box16',
      label: 'State wages · box 16',
      kind: 'money',
      anchors: ['16 State wages, tips, etc.', 'Box 16 State wages'],
      support: true,
    },
    {
      key: 'box17',
      label: 'State w/h · box 17',
      kind: 'money',
      anchors: ['17 State income tax', 'Box 17 State tax withheld'],
    },
    {
      key: 'box20',
      label: 'Local code · box 20',
      kind: 'code',
      anchors: ['20 Locality name', 'Box 20 Locality'],
    },
  ],
};

const PAYER: FieldSpec[] = [
  { key: 'name', label: 'Payer', kind: 'text', anchors: ["PAYER'S name", 'Payer'] },
  { key: 'tin', label: 'Payer TIN', kind: 'id', anchors: ["PAYER'S TIN", 'Payer TIN'] },
];

export const NEC: FormSpec = {
  docType: '1099-NEC',
  titleKeys: ['1099-NEC', 'Nonemployee Compensation'],
  fields: [
    ...PAYER,
    {
      key: 'box1',
      label: 'Nonemployee comp · box 1',
      kind: 'money',
      anchors: ['1 Nonemployee compensation', 'Box 1 Nonemployee compensation'],
    },
    {
      key: 'box4',
      label: 'Federal w/h · box 4',
      kind: 'money',
      anchors: ['4 Federal income tax withheld', 'Box 4 Federal tax withheld'],
    },
  ],
};

export const INT: FormSpec = {
  docType: '1099-INT',
  titleKeys: ['1099-INT', 'Interest Income'],
  fields: [
    ...PAYER,
    {
      key: 'box1',
      label: 'Interest income · box 1',
      kind: 'money',
      anchors: ['1 Interest income', 'Box 1 Interest income'],
    },
    {
      key: 'box2',
      label: 'Early withdrawal penalty · box 2',
      kind: 'money',
      anchors: ['2 Early withdrawal penalty', 'Box 2 Early withdrawal penalty'],
    },
  ],
};

export const FORMS: FormSpec[] = [W2, NEC, INT];

export const formByType = (docType: string): FormSpec | undefined =>
  FORMS.find((f) => f.docType === docType);

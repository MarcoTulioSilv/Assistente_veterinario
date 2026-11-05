'use client';

import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import {
  prescriptionFormSchema,
  type AnimalClinicalFormValues,
  type PrescriptionFormValues,
} from './schema';

const ROUTE_OPTIONS = [
  { value: 'oral', label: 'Oral' },
  { value: 'intravenosa', label: 'Intravenosa' },
  { value: 'intramuscular', label: 'Intramuscular' },
  { value: 'subcutanea', label: 'Subcutânea' },
  { value: 'topica', label: 'Tópica' },
  { value: 'intrauterina', label: 'Intrauterina' },
  { value: 'outra', label: 'Outra' },
];

const EMPTY_PRESCRIPTION: PrescriptionFormValues = {
  productId: '',
  medicationName: '',
  dose: '',
  route: 'oral',
  schedule: '',
  applicationSite: '',
  notes: '',
};

interface AnimalClinicalEditorProps {
  animalName: string;
  value: AnimalClinicalFormValues;
  onChange: (value: AnimalClinicalFormValues) => void;
}

/** RF-ATD-001/005: ficha clínica e receita de UM animal do orçamento (reunião 20/10/2026 — ficha e receita são por animal). */
export function AnimalClinicalEditor({
  animalName,
  value,
  onChange,
}: AnimalClinicalEditorProps): React.ReactElement {
  const [draft, setDraft] = useState<PrescriptionFormValues>(EMPTY_PRESCRIPTION);
  const [draftError, setDraftError] = useState<string | undefined>();

  function updateRecord(field: keyof AnimalClinicalFormValues['medicalRecord'], text: string): void {
    onChange({ ...value, medicalRecord: { ...value.medicalRecord, [field]: text } });
  }

  function addPrescription(): void {
    const result = prescriptionFormSchema.safeParse(draft);
    if (!result.success) {
      setDraftError(result.error.issues[0]?.message ?? 'Prescrição inválida');
      return;
    }
    onChange({ ...value, prescriptions: [...value.prescriptions, result.data] });
    setDraft(EMPTY_PRESCRIPTION);
    setDraftError(undefined);
  }

  function removePrescription(index: number): void {
    onChange({ ...value, prescriptions: value.prescriptions.filter((_, i) => i !== index) });
  }

  return (
    <details className="rounded-md border border-slate-200">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">
        Ficha clínica e receita — {animalName}
      </summary>
      <div className="flex flex-col gap-3 border-t border-slate-200 p-3">
        <Input
          label="Anamnese"
          value={value.medicalRecord.anamnesis}
          onChange={(e) => updateRecord('anamnesis', e.target.value)}
        />
        <Input
          label="Diagnóstico"
          value={value.medicalRecord.diagnosis}
          onChange={(e) => updateRecord('diagnosis', e.target.value)}
        />
        <Input
          label="Tratamento"
          value={value.medicalRecord.treatment}
          onChange={(e) => updateRecord('treatment', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Prognóstico"
            value={value.medicalRecord.prognosis}
            onChange={(e) => updateRecord('prognosis', e.target.value)}
          />
          <Input
            label="Encaminhamento"
            value={value.medicalRecord.referral}
            onChange={(e) => updateRecord('referral', e.target.value)}
          />
        </div>

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">Receita</legend>

          {value.prescriptions.length > 0 && (
            <ul className="mb-3 space-y-1">
              {value.prescriptions.map((p, index) => (
                <li key={index} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-900">
                    {p.medicationName} — {p.dose}, {p.schedule}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePrescription(index)}
                    className="shrink-0 text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Medicamento"
              value={draft.medicationName}
              onChange={(e) => setDraft((prev) => ({ ...prev, medicationName: e.target.value }))}
            />
            <Input
              label="Dose"
              value={draft.dose}
              onChange={(e) => setDraft((prev) => ({ ...prev, dose: e.target.value }))}
            />
            <Select
              label="Via"
              options={ROUTE_OPTIONS}
              defaultValue={draft.route}
              onChange={(e) => setDraft((prev) => ({ ...prev, route: e.target.value as PrescriptionFormValues['route'] }))}
            />
            <Input
              label="Frequência"
              placeholder="Ex.: a cada 12h por 5 dias"
              value={draft.schedule}
              onChange={(e) => setDraft((prev) => ({ ...prev, schedule: e.target.value }))}
            />
          </div>
          {draftError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {draftError}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addPrescription}>
            Adicionar à receita
          </Button>
        </fieldset>
      </div>
    </details>
  );
}

import React, { useEffect, useState } from 'react';
import { Modal, Input, Form } from 'antd';
import axiosInstance from '@api/axiosInstance';
import { useScenarioStore } from '@stores/useScenarioStore';
import { ScenarioVersions } from '@type/Scenario';

interface SaveVersionModalProps {
    open: boolean;
    onConfirm: (versionKey: string) => Promise<void>;
    onCancel: () => void;
}

function suggestNextVersionKey(currentKey: string | undefined, scenarioKey: string): string {
    if (!currentKey) return `${scenarioKey}_V1`;
    const match = currentKey.match(/^(.+?)_V(\d+)$/);
    if (match) {
        return `${match[1]}_V${parseInt(match[2], 10) + 1}`;
    }
    return `${currentKey}_V2`;
}

const SaveVersionModal: React.FC<SaveVersionModalProps> = ({ open, onConfirm, onCancel }) => {
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedScenario = useScenarioStore.getState().selectedScenario;
    const selectedScenarioVersion = useScenarioStore.getState().selectedScenarioVersion;
    const setVersion = useScenarioStore.getState().setVersion;

    useEffect(() => {
        if (open && selectedScenario) {
            const suggestedKey = suggestNextVersionKey(selectedScenarioVersion?.key, selectedScenario.key);
            const versionCount = selectedScenarioVersion?.label?.match(/\d+/)?.[0];
            const nextNum = versionCount ? parseInt(versionCount, 10) + 1 : 2;
            form.setFieldsValue({
                key: suggestedKey,
                label: `버전 ${nextNum}`,
            });
            setError(null);
        }
    }, [open, selectedScenario, selectedScenarioVersion]);

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            if (!selectedScenario) return;
            setSaving(true);
            setError(null);

            const response = await axiosInstance({
                method: 'POST',
                url: `/scenario/${selectedScenario.id}/versions`,
                data: { key: values.key, label: values.label },
            });

            const newVersion: ScenarioVersions = response.data;
            setVersion(newVersion);

            await onConfirm(newVersion.key);
        } catch (err: unknown) {
            if (err && typeof err === 'object' && 'errorFields' in err) return; // form validation
            const message = err instanceof Error ? err.message : '버전 생성 실패';
            setError(message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title="새 버전으로 저장"
            open={open}
            onOk={handleOk}
            onCancel={onCancel}
            okText="저장"
            cancelText="취소"
            confirmLoading={saving}
            width={360}
        >
            <p style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>
                저장 시 새 버전이 생성됩니다.
                {selectedScenarioVersion && (
                    <> 현재 버전: <strong>{selectedScenarioVersion.label}</strong> ({selectedScenarioVersion.key})</>
                )}
            </p>
            <Form form={form} layout="vertical" size="small">
                <Form.Item
                    name="key"
                    label="버전 키"
                    rules={[
                        { required: true, message: '버전 키를 입력하세요.' },
                        { pattern: /^[A-Za-z0-9_]+$/, message: '영문자, 숫자, 밑줄(_)만 허용됩니다.' },
                    ]}
                >
                    <Input placeholder="예: SCENARIO_V2" />
                </Form.Item>
                <Form.Item
                    name="label"
                    label="버전 이름"
                    rules={[{ required: true, message: '버전 이름을 입력하세요.' }]}
                >
                    <Input placeholder="예: 버전 2" />
                </Form.Item>
            </Form>
            {error && (
                <div style={{ color: '#f07070', fontSize: 11, marginTop: 4 }}>{error}</div>
            )}
        </Modal>
    );
};

export default SaveVersionModal;

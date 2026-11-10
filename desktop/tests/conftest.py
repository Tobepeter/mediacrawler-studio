import pytest


@pytest.fixture(autouse=True)
def isolated_pacing_state(tmp_path, monkeypatch):
    # 节流状态落盘共享，测试不能动真实目录里的名额和冷却
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))

import pytest


@pytest.fixture(autouse=True)
def isolated_pacing(tmp_path, monkeypatch):
    # 节流状态是真实文件，测试不能占用真实额度
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
